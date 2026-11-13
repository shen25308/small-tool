import Foundation
import CryptoKit
import Darwin

struct ConnectorNotice: Equatable {
    let id: String
    let source: String
    let title: String
    let summary: String
    let time: Double
    let link: String
    var read: Bool
    var archived: Bool = false
}

private struct IncomingEvent: Codable {
    let version: Int
    let eventID: String
    let source: String
    let title: String
    let summary: String
    let time: Double
    let link: String

    var digest: String {
        SHA256.hash(data: Data((source + "\0" + eventID).precomposedStringWithCanonicalMapping.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }
}

// Use the same serial inbox queue for scanning, native deliveries and marking messages read.
// Delivery files never change. Read receipts are independent of concurrent external senders.
final class ConnectorInbox {
    private let directory: URL
    private let manager = FileManager.default
    private var known: [String: ConnectorNotice] = [:]
    private var initialized = false

    init(directory: URL) { self.directory = directory }

    static func safeLink(_ value: String, source: String) -> URL? {
        guard !value.isEmpty, value.utf8.count <= 2048, !value.contains("\\"),
              value.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              let parts = URLComponents(string: value), parts.scheme?.lowercased() == "https",
              parts.user == nil, parts.password == nil, parts.port == nil || parts.port == 443,
              let host = parts.host?.lowercased(), let url = parts.url else { return nil }
        let name = source.lowercased()
        let allowed: Bool
        if name=="gmail" {
            allowed = host=="mail.google.com" && parts.percentEncodedPath.hasPrefix("/mail/")
        } else if name=="outlook" {
            allowed = ["outlook.office.com","outlook.office365.com","outlook.live.com"].contains(host)
        } else if name=="github actions" {
            allowed = host=="github.com" && parts.percentEncodedPath.range(of:#"^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?/?$"#,options:.regularExpression) != nil
        } else if name.hasPrefix("grok") || name == "xai" || name == "x.ai" {
            allowed = ["grok.com", "www.grok.com"].contains(host) ||
                (["x.com", "www.x.com"].contains(host) &&
                 (parts.percentEncodedPath == "/i/grok" || parts.percentEncodedPath.hasPrefix("/i/grok/")))
        } else if ["chatgpt", "codex", "openai"].contains(where: { name.hasPrefix($0) }) {
            allowed = host == "chatgpt.com"
        } else if name.hasPrefix("claude") {
            allowed = host == "claude.ai"
        } else if name.hasPrefix("gemini") {
            allowed = host == "gemini.google.com"
        } else {
            allowed = false
        }
        return allowed ? url : nil
    }

    private func field(_ value: String, name: String, byteLimit: Int) throws -> String {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
        guard !clean.isEmpty, clean.utf8.count <= byteLimit,
              clean.rangeOfCharacter(from: .controlCharacters) == nil else {
            throw AppIssue("\(name) is empty, too long, or contains control characters.")
        }
        return clean
    }

    private func validate(_ event: IncomingEvent) throws {
        guard event.version == 1, event.time.isFinite, event.time > 0, event.time < 253402300800,
              !event.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              event.summary.utf8.count <= 65536, !event.summary.contains("\0"),
              event.link.isEmpty || Self.safeLink(event.link, source: event.source) != nil else {
            throw AppIssue("The inbox data is invalid, or the conversation link does not match its source.")
        }
        _ = try field(event.source, name: "Source", byteLimit: 100)
        _ = try field(event.title, name: "Title", byteLimit: 640)
        _ = try field(event.eventID, name: "Event ID", byteLimit: 512)
    }

    private func prepare() throws {
        try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700])
    }

    private func readEvent(_ file: URL, digest: String) throws -> ConnectorNotice {
        let info = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard info.isRegularFile == true, info.isSymbolicLink != true,
              let length = info.fileSize, length <= 480 * 1024 else { throw AppIssue("Invalid inbox file.") }
        let event = try JSONDecoder().decode(IncomingEvent.self, from: Data(contentsOf: file))
        try validate(event)
        guard event.digest == digest else { throw AppIssue("The inbox event ID does not match.") }
        return ConnectorNotice(id: "connector/" + digest, source: event.source, title: event.title,
                               summary: event.summary, time: event.time, link: event.link, read: false)
    }

    func scan() throws -> (notices: [ConnectorNotice], changed: Bool) {
        try prepare()
        let files = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil,
                                                    options: [.skipsHiddenFiles])
        let receipts = Set(files.filter { $0.pathExtension == "read" }.map { $0.deletingPathExtension().lastPathComponent })
        let archives = Set(files.filter { $0.pathExtension == "archived" }.map { $0.deletingPathExtension().lastPathComponent })
        var next: [String: ConnectorNotice] = [:]
        for file in files where file.pathExtension == "json" {
            let digest = file.deletingPathExtension().lastPathComponent
            guard digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) else { continue }
            // Local senders publish via exclusive hard link; a cached event is immutable.
            guard var message = known[digest] ?? (try? readEvent(file, digest: digest)) else { continue }
            message.read = receipts.contains(digest)
            message.archived = archives.contains(digest)
            next[digest] = message
        }
        let changed = !initialized || next != known
        known = next
        initialized = true
        let sorted = next.values.sorted { $0.time == $1.time ? $0.id < $1.id : $0.time > $1.time }
        return (sorted, changed)
    }

    func markRead(_ key: String) throws -> [ConnectorNotice] {
        try setState(key, read: true, archived: nil)
    }

    /// Read and archived are empty marker files beside the event. The event file itself never changes.
    func setState(_ key: String, read: Bool?, archived: Bool?) throws -> [ConnectorNotice] {
        guard key.hasPrefix("connector/") else { throw AppIssue("Unknown inbox event ID.") }
        let digest = String(key.dropFirst("connector/".count))
        _ = try scan()
        guard known[digest] != nil else { throw AppIssue("This message no longer exists.") }
        func mark(_ suffix: String, _ on: Bool?) throws {
            guard let on else { return }
            let marker = directory.appendingPathComponent(digest + "." + suffix)
            if on {
                if !manager.fileExists(atPath: marker.path) { try Data().write(to: marker, options: .atomic) }
            } else if manager.fileExists(atPath: marker.path) {
                try manager.removeItem(at: marker)
            }
        }
        try mark("read", read)
        try mark("archived", archived)
        return try scan().notices
    }

    @discardableResult
    func receive(source: String, title: String, summary: String, link: String? = nil,
                 eventID: String? = nil) throws -> ConnectorNotice {
        let event = IncomingEvent(version: 1, eventID: try field(eventID ?? UUID().uuidString, name: "Event ID", byteLimit: 512),
                                  source: try field(source, name: "Source", byteLimit: 100),
                                  title: try field(title, name: "Title", byteLimit: 640),
                                  summary: summary.trimmingCharacters(in: .whitespacesAndNewlines),
                                  time: Date().timeIntervalSince1970, link: link ?? "")
        try validate(event)
        try prepare()
        let digest = event.digest
        let pending = directory.appendingPathComponent(".pending-" + UUID().uuidString)
        let final = directory.appendingPathComponent(digest + ".json")
        let bytes = try JSONEncoder().encode(event)
        guard manager.createFile(atPath: pending.path, contents: bytes, attributes: [.posixPermissions: 0o600]) else {
            throw AppIssue("Shishi could not write to its inbox folder.")
        }
        defer { try? manager.removeItem(at: pending) }
        if Darwin.link(pending.path, final.path) != 0, errno != EEXIST {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        var result = try readEvent(final, digest: digest)
        result.read = manager.fileExists(atPath: directory.appendingPathComponent(digest + ".read").path)
        return result
    }

    static func wire(_ notices: [ConnectorNotice]) -> [[String: Any]] {
        notices.map { ["id": $0.id, "source": $0.source, "title": $0.title, "summary": $0.summary,
                        "time": $0.time, "read": $0.read, "archived": $0.archived, "thread": "", "link": $0.link] }
    }
}
