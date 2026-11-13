import Foundation

/// Permission requests that the optional Claude Code hook has put on Shishi's card, and the answers to them.
/// The hook waits only while Shishi's heartbeat file is fresh, so a closed Shishi never delays Claude.
/// All calls run on the inbox queue, except `wait`, which only reads or writes a small settings file.
final class ApprovalBoard {
    private let directory: URL
    private let manager = FileManager.default
    static let waits = [15, 25, 45, 90]

    init(directory: URL) { self.directory = directory }

    private func prepare() {
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }

    /// Tells the hook that Shishi is open. It treats a file older than 30 seconds as closed.
    func heartbeat() {
        prepare()
        let alive = directory.appendingPathComponent(".alive")
        if manager.fileExists(atPath: alive.path) {
            try? manager.setAttributes([.modificationDate: Date()], ofItemAtPath: alive.path)
        } else {
            manager.createFile(atPath: alive.path, contents: Data(), attributes: [.posixPermissions: 0o600])
        }
    }

    /// Called when Shishi quits, so a request never waits for an app that is gone.
    func closed() { try? manager.removeItem(at: directory.appendingPathComponent(".alive")) }

    private static func validID(_ id: String) -> Bool { id.count == 32 && id.allSatisfy { $0.isHexDigit && !$0.isUppercase } }

    private static func line(_ value: Any?, _ limit: Int) -> String {
        String(((value as? String) ?? "").prefix(limit))
    }

    func pending() -> [[String: Any]] {
        prepare()
        let now = Date().timeIntervalSince1970
        let files = (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
        var rows: [[String: Any]] = []
        for file in files where file.pathExtension == "json" {
            let id = file.deletingPathExtension().lastPathComponent
            guard Self.validID(id), let data = try? Data(contentsOf: file), data.count <= 64 * 1024,
                  let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let expires = object["expires"] as? Double, expires > now - 5 else { continue }
            rows.append(["id": id, "session": Self.line(object["session"], 200), "source": Self.line(object["source"], 60),
                         "project": Self.line(object["project"], 120), "tool": Self.line(object["tool"], 80),
                         "detail": Self.line(object["detail"], 16000), "length": object["length"] as? Int ?? -1, "reason": Self.line(object["reason"], 300),
                         "time": object["time"] as? Double ?? now, "expires": expires])
        }
        return rows.sorted { ($0["time"] as? Double ?? 0) < ($1["time"] as? Double ?? 0) }
    }

    /// Writes the answer for a request that is still waiting. Returns false when the hook has already given up.
    func answer(_ id: String, behavior: String) -> Bool {
        guard Self.validID(id), ["allow", "deny"].contains(behavior),
              manager.fileExists(atPath: directory.appendingPathComponent(id + ".json").path),
              let data = try? JSONSerialization.data(withJSONObject: ["behavior": behavior]) else { return false }
        return (try? data.write(to: directory.appendingPathComponent(id + ".decision"), options: .atomic)) != nil
    }

    var wait: Int {
        get {
            let file = directory.appendingPathComponent("settings.json")
            let value = ((try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["wait"] as? Int
            return value.flatMap { Self.waits.contains($0) ? $0 : nil } ?? 25
        }
        set {
            guard Self.waits.contains(newValue), let data = try? JSONSerialization.data(withJSONObject: ["wait": newValue]) else { return }
            prepare()
            try? data.write(to: directory.appendingPathComponent("settings.json"), options: .atomic)
        }
    }
}
