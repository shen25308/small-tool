import AppKit
import Darwin
import Foundation

/// What a finished turn actually did, read by the hook from the agent's own session log.
struct AgentFacts: Equatable {
    let files: [String]
    let fileCount, commands, failedTools: Int
    let tests, testCommand: String

    init?(_ value: Any?) {
        guard let object = value as? [String: Any], let tests = object["tests"] as? String,
              ["passed", "failed", "none"].contains(tests) else { return nil }
        let count = { (key: String) in max(0, min(object[key] as? Int ?? 0, 100_000)) }
        files = (object["files"] as? [Any] ?? []).compactMap { $0 as? String }
            .map { String($0.components(separatedBy: .controlCharacters).joined().prefix(300)) }.filter { !$0.isEmpty }.prefix(12).map { $0 }
        fileCount = max(count("fileCount"), files.count)
        commands = count("commands")
        failedTools = count("failedTools")
        self.tests = tests
        testCommand = String(((object["testCommand"] as? String) ?? "").components(separatedBy: .controlCharacters).joined(separator: " ").prefix(120))
    }

    var wire: [String: Any] {
        ["files": files, "fileCount": fileCount, "commands": commands, "failedTools": failedTools, "tests": tests, "testCommand": testCommand]
    }
}

struct AgentState: Equatable {
    let key, source, title, detail, state, receipt, task, app, activity, shishiTask, cwd: String
    /// Where the session runs (iTerm2 session, tty, tmux pane), validated again before use.
    let terminal: [String: String]
    /// The permission request this session is waiting on, when Shishi's card can answer it.
    let approval: String
    let time, started: Double
    let tools: Int
    let facts: AgentFacts?
    /// The session's process exited without a final reply, for example when its terminal was closed.
    let ended: Bool
}

/// Reads the one-file-per-session states that local agent hooks publish. All calls run on the inbox queue.
final class AgentBoard {
    private let directory: URL
    private let manager = FileManager.default
    private var last: [AgentState] = []
    private var initialized = false
    private static let states: Set<String> = ["working", "done", "attention", "idle"]

    init(directory: URL) { self.directory = directory }

    private static func line(_ value: Any?, limit: Int) -> String {
        guard let text = value as? String else { return "" }
        let flat = text.components(separatedBy: .controlCharacters).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(flat.prefix(limit))
    }

    static func validBundle(_ value: String) -> Bool {
        value.count <= 120 && value.range(of: #"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$"#, options: .regularExpression) != nil
    }

    private static func validKey(_ key: String) -> Bool {
        key.count == 64 && key.allSatisfy { $0.isHexDigit }
    }

    func scan() -> (items: [AgentState], changed: Bool) {
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                     attributes: [.posixPermissions: 0o700])
        let files = (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil,
                                                      options: [.skipsHiddenFiles])) ?? []
        let now = Date().timeIntervalSince1970
        var rows: [AgentState] = []
        for file in files where file.pathExtension == "json" {
            let key = file.deletingPathExtension().lastPathComponent
            guard Self.validKey(key),
                  let info = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
                  info.isRegularFile == true, info.isSymbolicLink != true,
                  let size = info.fileSize, size <= 16 * 1024,
                  let data = try? Data(contentsOf: file),
                  let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let time = object["time"] as? Double, time.isFinite, time > 0,
                  let state = object["state"] as? String, Self.states.contains(state) else { continue }
            // A session that crashed never reports again. Finished results expire after a day.
            let age = now - time
            if age > (state == "done" || state == "attention" ? 24 * 3600 : 6 * 3600) {
                try? manager.removeItem(at: file)
                continue
            }
            let title = Self.line(object["title"], limit: 200)
            let receipt = Self.line(object["receipt"], limit: 80)
            let app = object["app"] as? String ?? ""
            let started = (object["started"] as? Double).flatMap { $0.isFinite && $0 > 0 && $0 <= time ? $0 : nil } ?? 0
            // A working session whose process is gone will never report again. Show that it stopped, then let it go.
            let pid = (object["pid"] as? Int).flatMap { $0 > 1 && $0 < Int(Int32.max) ? pid_t($0) : nil }
            var ended = false
            if (state == "working" || state == "attention"), let pid, kill(pid, 0) == -1, errno == ESRCH {
                if age > 3600 { try? manager.removeItem(at: file); continue }
                ended = true
            }
            rows.append(AgentState(key: key, source: Self.line(object["source"], limit: 100),
                                   title: title.isEmpty ? "Agent" : title,
                                   detail: ended ? "The session ended without a final reply." : Self.line(object["detail"], limit: 400),
                                   state: ended ? "idle" : state,
                                   receipt: receipt.hasPrefix("connector/") ? receipt : "",
                                   task: Self.line(object["task"], limit: 400), app: Self.validBundle(app) ? app : "",
                                   activity: ended ? "" : Self.line(object["activity"], limit: 120),
                                   shishiTask: (object["shishiTask"] as? String).flatMap { $0.range(of: #"^[0-9A-Za-z-]{8,64}$"#, options: .regularExpression) != nil ? $0 : nil } ?? "",
                                   cwd: Self.line(object["cwd"], limit: 1024).hasPrefix("/") ? Self.line(object["cwd"], limit: 1024) : "",
                                   terminal: ((object["terminal"] as? [String: Any]) ?? [:]).reduce(into: [:]) { result, item in
                                       if ["iterm", "tty", "tmuxPane", "tmuxSocket"].contains(item.key), let value = item.value as? String, value.count < 300 { result[item.key] = value }
                                   },
                                   approval: (object["approval"] as? String).flatMap { $0.count == 32 && $0.allSatisfy(\.isHexDigit) ? $0 : nil } ?? "",
                                   time: time, started: started, tools: max(0, min(object["tools"] as? Int ?? 0, 1_000_000)),
                                   facts: AgentFacts(object["facts"]), ended: ended))
        }
        rows.sort { $0.time == $1.time ? $0.key < $1.key : $0.time > $1.time }
        let changed = !initialized || rows != last
        last = rows
        initialized = true
        return (rows, changed)
    }

    func dismiss(_ key: String) {
        guard Self.validKey(key) else { return }
        try? manager.removeItem(at: directory.appendingPathComponent(key + ".json"))
    }

    static func wire(_ rows: [AgentState]) -> [[String: Any]] {
        rows.map { row in
            var wire: [String: Any] = ["key": row.key, "source": row.source, "title": row.title, "detail": row.detail,
                                       "state": row.state, "receipt": row.receipt, "time": row.time, "task": row.task,
                                       "app": row.app, "started": row.started, "activity": row.activity, "tools": row.tools, "approval": row.approval, "cwd": row.cwd, "shishiTask": row.shishiTask, "terminal": row.terminal,
                                       "ended": row.ended]
            if let facts = row.facts { wire["facts"] = facts.wire }
            return wire
        }
    }
}

/// Calls the handler when an entry is added to or removed from a folder.
final class DirectoryWatcher {
    private var source: DispatchSourceFileSystemObject?

    init(url: URL, queue: DispatchQueue, handler: @escaping () -> Void) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        let descriptor = Darwin.open(url.path, O_EVTONLY)
        guard descriptor >= 0 else { return }
        let watcher = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor,
                                                                eventMask: [.write, .rename, .delete], queue: queue)
        watcher.setEventHandler(handler: handler)
        watcher.setCancelHandler { Darwin.close(descriptor) }
        watcher.resume()
        source = watcher
    }

    deinit { source?.cancel() }
}

/// A small menu bar item: how many agents are working, which need you, and what finished.
final class MenuBarStatus: NSObject {
    private var item: NSStatusItem?
    private var agents: [AgentState] = []
    private var unread = 0
    var onOpen: ((_ inbox: Bool) -> Void)?
    var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "ShiShiMenuBar")
            refresh()
        }
    }

    override init() {
        enabled = UserDefaults.standard.object(forKey: "ShiShiMenuBar") as? Bool ?? true
        super.init()
    }

    func update(agents: [AgentState]) { self.agents = agents; refresh() }
    func update(unread: Int) {
        guard unread != self.unread else { return }
        self.unread = unread
        refresh()
    }

    private func refresh() {
        guard enabled else {
            if let item { NSStatusBar.system.removeStatusItem(item) }
            item = nil
            return
        }
        if item == nil { item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength) }
        guard let item, let button = item.button else { return }
        let working = agents.filter { $0.state == "working" }.count
        let waiting = agents.filter { $0.state == "attention" }.count
        let symbol = waiting > 0 ? "exclamationmark.circle.fill"
            : working > 0 ? "circle.dotted" : unread > 0 ? "checkmark.circle.fill" : "checkmark.circle"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Shishi")
        image?.isTemplate = true
        button.image = image
        button.imagePosition = .imageLeading
        button.title = working > 0 ? " \(working)" : unread > 0 ? " \(unread)" : ""
        button.toolTip = waiting > 0 ? "An agent is waiting for you"
            : working > 0 ? "\(working) working" : unread > 0 ? "\(unread) unread" : "Shishi"

        let menu = NSMenu()
        menu.autoenablesItems = false
        if agents.isEmpty {
            let empty = NSMenuItem(title: "No active agents", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        }
        for agent in agents.prefix(8) {
            let label = agent.state == "working" ? "Working" : agent.state == "attention" ? "Needs you"
                : agent.state == "done" ? "Finished" : "Idle"
            let row = NSMenuItem(title: label + " · " + String(agent.title.prefix(60)),
                                 action: #selector(openInbox), keyEquivalent: "")
            row.target = self
            row.toolTip = agent.detail
            menu.addItem(row)
        }
        menu.addItem(.separator())
        let inbox = NSMenuItem(title: unread > 0 ? "Open Inbox (\(unread) unread)" : "Open Inbox",
                               action: #selector(openInbox), keyEquivalent: "")
        inbox.target = self
        menu.addItem(inbox)
        let workspace = NSMenuItem(title: "Open Shishi", action: #selector(openWorkspace), keyEquivalent: "")
        workspace.target = self
        menu.addItem(workspace)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Shishi", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        item.menu = menu
    }

    @objc private func openInbox() { onOpen?(true) }
    @objc private func openWorkspace() { onOpen?(false) }
}
