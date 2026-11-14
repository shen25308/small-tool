import Foundation
import Darwin

struct CodexNotice: Codable {
    var id: String
    var thread: String
    var title: String
    var summary: String
    var time: Double
    var read: Bool = false
    // Added in workspace format 2. Absent means false, so receipts saved by earlier versions still load.
    var archived: Bool?
    var accepted: Bool?
}

/// A change to a result's local state. A nil field is left as it is.
struct NoticeFlags {
    var read: Bool?
    var archived: Bool?
    var accepted: Bool?
}

private struct RolloutCursor: Codable, Equatable {
    var next: Int64
    var ignore: Bool = false
}

private struct InboxFile: Codable {
    var since: Double
    var cursors: [String:RolloutCursor] = [:]
    var notices: [CodexNotice] = []
}

// All calls run on the same serial background queue. Offsets and notices commit together.
final class CodexInbox {
    private let root: URL
    private let store: URL
    private var saved: InboxFile?
    private let completeMarker = Data("\"task_complete\"".utf8)
    private let dates = ISO8601DateFormatter()
    private let simpleDates = ISO8601DateFormatter()
    private var userTitles: [String:String] = [:]
    private var indexTime = Date.distantPast

    init(root: URL, store: URL) {
        self.root = root
        self.store = store
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }
    private func load() throws -> InboxFile {
        if let saved { return saved }
        if FileManager.default.fileExists(atPath: store.path) {
            return try JSONDecoder().decode(InboxFile.self, from: Data(contentsOf: store))
        }
        return InboxFile(since: Date().timeIntervalSince1970)
    }
    private func commit(_ value: InboxFile) throws {
        try FileManager.default.createDirectory(at: store.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions:0o700])
        try JSONEncoder().encode(value).write(to:store, options:.atomic)
        saved = value
    }
    private func refreshTitles() {
        let url = root.appendingPathComponent("session_index.jsonl")
        guard let modified = try? url.resourceValues(forKeys:[.contentModificationDateKey]).contentModificationDate,
              modified != indexTime, let bytes = try? Data(contentsOf:url) else { return }
        var result: [String:String] = [:]
        for line in bytes.split(separator:10) {
            guard let row = try? JSONSerialization.jsonObject(with: line) as? [String:Any],
                  let id=row["id"] as? String, let name=row["thread_name"] as? String, !name.isEmpty else { continue }
            result[id.lowercased()] = String(name.prefix(140))
        }
        indexTime=modified
        userTitles=result
    }
    private func title(_ id:String, _ meta:[String:Any]) -> String {
        if let name=userTitles[id] {return name}
        let folder=(meta["cwd"] as? String).map {URL(fileURLWithPath:$0).lastPathComponent} ?? ""
        return folder.isEmpty ? "Codex conversation" : "Codex · "+String(folder.prefix(70))
    }
    func scan() throws -> (notices:[CodexNotice], changed:Bool) {
        var next=try load()
        let first=saved == nil
        var seen=Set(next.notices.map(\.id))
        let count=next.notices.count
        let oldCursors=next.cursors
        let fm=FileManager.default
        refreshTitles()
        let folders=["sessions","archived_sessions"].map{root.appendingPathComponent($0)}
        guard fm.isReadableFile(atPath:folders[0].path) else {throw AppIssue("Shishi cannot read local Codex conversations right now. It will retry automatically.")}
        for folder in folders where fm.fileExists(atPath:folder.path) {
            guard let iterator=fm.enumerator(at:folder,includingPropertiesForKeys:[.fileSizeKey,.contentModificationDateKey],options:[.skipsHiddenFiles]) else {continue}
            for case let file as URL in iterator {
                guard file.pathExtension=="jsonl",file.lastPathComponent.hasPrefix("rollout-") else {continue}
                let id=String(file.deletingPathExtension().lastPathComponent.suffix(36)).lowercased()
                guard UUID(uuidString:id) != nil, let info=try? file.resourceValues(forKeys:[.fileSizeKey,.contentModificationDateKey]),let length=info.fileSize else {continue}
                let size=Int64(length)
                if next.cursors[id] == nil, (info.contentModificationDate?.timeIntervalSince1970 ?? 0)<next.since {
                    next.cursors[id]=RolloutCursor(next:size)
                    continue
                }
                var cursor=next.cursors[id] ?? RolloutCursor(next:0)
                if cursor.ignore || cursor.next==size {continue}
                if cursor.next>size {cursor=RolloutCursor(next:0)}
                // An archive move can race this scan. Its cursor stays intact for the next cycle.
                guard let stream=fopen(file.path,"rb") else {continue}
                defer {fclose(stream)}
                var buffer: UnsafeMutablePointer<CChar>?
                var capacity=0
                defer {free(buffer)}
                let headerSize=getline(&buffer,&capacity,stream)
                guard headerSize>0, let head=buffer, head[headerSize-1]==10,
                      let wrapper=try? JSONSerialization.jsonObject(with:Data(bytes:head,count:headerSize)) as? [String:Any],
                      wrapper["type"] as? String=="session_meta",let meta=wrapper["payload"] as? [String:Any] else {continue}
                if (meta["thread_source"] as? String).map({$0 != "user"}) == true || meta["source"] is [String:Any] {
                    next.cursors[id]=RolloutCursor(next:size,ignore:true)
                    continue
                }
                guard fseeko(stream,max(cursor.next,Int64(headerSize)),SEEK_SET)==0 else {continue}
                while true {
                    let n=getline(&buffer,&capacity,stream)
                    guard n>0,let line=buffer,line[n-1]==10 else {break}
                    cursor.next=ftello(stream)
                    let bytes=Data(bytesNoCopy:line,count:n,deallocator:.none)
                    guard bytes.range(of:completeMarker) != nil,
                          let event=try? JSONSerialization.jsonObject(with:bytes) as? [String:Any],
                          event["type"] as? String=="event_msg", let payload=event["payload"] as? [String:Any],
                          payload["type"] as? String=="task_complete",let turn=payload["turn_id"] as? String, !turn.isEmpty else {continue}
                    let stamp=event["timestamp"] as? String ?? ""
                    let time=dates.date(from:stamp)?.timeIntervalSince1970 ?? simpleDates.date(from:stamp)?.timeIntervalSince1970 ?? payload["completed_at"] as? Double ?? 0
                    let key=id+"/"+turn
                    guard time>=next.since, seen.insert(key).inserted else {continue}
                    let msg=(payload["last_agent_message"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
                    next.notices.append(CodexNotice(id:key,thread:id,title:title(id,meta),summary:msg,time:time))
                }
                next.cursors[id]=cursor
            }
        }
        let newItems=count != next.notices.count
        if newItems {next.notices.sort{$0.time>$1.time}}
        if first || oldCursors != next.cursors || newItems {try commit(next)}
        return (next.notices,first || newItems)
    }
    func storedNotices() throws -> [CodexNotice] {
        return try load().notices
    }

    // Reconnecting starts a new collection interval while preserving earlier receipts.
    func startInterval() throws {
        var state=try load()
        state.since=Date().timeIntervalSince1970
        state.cursors=[:]
        try commit(state)
    }

    func markRead(_ key:String) throws -> [CodexNotice] {
        var state=try load()
        guard let index=state.notices.firstIndex(where:{$0.id==key}) else {throw AppIssue("This message no longer exists.")}
        if !state.notices[index].read {state.notices[index].read=true;try commit(state)}
        return state.notices
    }
    func setFlags(_ key:String, _ flags:NoticeFlags) throws {
        var state=try load()
        guard let index=state.notices.firstIndex(where:{$0.id==key}) else {throw AppIssue("This message no longer exists.")}
        var notice=state.notices[index]
        if let read=flags.read {notice.read=read}
        if let archived=flags.archived {notice.archived=archived ? true : nil}
        if let accepted=flags.accepted {notice.accepted=accepted ? true : nil}
        state.notices[index]=notice
        try commit(state)
    }
    static func wire(_ notices:[CodexNotice]) -> [[String:Any]] {
        notices.map{["id":$0.id,"thread":$0.thread,"title":$0.title,"summary":$0.summary,"time":$0.time,"read":$0.read,
                     "archived":$0.archived ?? false,"accepted":$0.accepted ?? false]}
    }
}
