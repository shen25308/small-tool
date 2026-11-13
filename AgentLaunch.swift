import AppKit

/// Starts Claude Code or Codex in a new Terminal or iTerm2 window, in a list's project folder, with a task as
/// the prompt. The prompt travels in a private file, never on the command line, and the task's ID travels in
/// SHISHI_TASK so the Claude Code hook can link the session back to the task.
enum AgentLaunch {
    static let agents = ["claude": "claude", "codex": "codex"]

    static func chooseFolder(_ done: @escaping (String?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Choose the Project Folder"
        panel.message = "Agents started from tasks in this list work in this folder."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        panel.begin { answer in done(answer == .OK ? panel.url?.path : nil) }
    }

    static func quoted(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    private static func appleScriptString(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    /// Returns the name of the terminal it used.
    static func start(agent: String, folder: String, prompt: String, task: String, terminal: String, support: URL) throws -> String {
        guard let command = agents[agent] else { throw AppIssue("Unknown agent.") }
        var isFolder: ObjCBool = false
        guard folder.hasPrefix("/"), folder.count < 1024, FileManager.default.fileExists(atPath: folder, isDirectory: &isFolder), isFolder.boolValue else {
            throw AppIssue("The project folder for this list no longer exists. Choose it again.")
        }
        guard task.range(of: #"^[0-9A-Za-z-]{8,64}$"#, options: .regularExpression) != nil else { throw AppIssue("The task ID is invalid.") }
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf8.count <= 20_000 else { throw AppIssue("The task has no title to send.") }
        let prompts = support.appendingPathComponent("Prompts", isDirectory: true)
        try FileManager.default.createDirectory(at: prompts, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = prompts.appendingPathComponent(task + ".txt")
        try Data(text.utf8).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        let shell = "cd " + quoted(folder) + " && SHISHI_TASK=" + quoted(task) + " " + command + " \"$(cat " + quoted(file.path) + ")\""
        let useITerm = terminal == "iTerm2" && NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.googlecode.iterm2") != nil
        let script = useITerm ? """
            tell application id "com.googlecode.iterm2"
              activate
              set newWindow to (create window with default profile)
              tell current session of newWindow to write text \(appleScriptString(shell))
            end tell
            """ : """
            tell application id "com.apple.Terminal"
              activate
              do script \(appleScriptString(shell))
            end tell
            """
        var error: NSDictionary?
        _ = NSAppleScript(source: script)?.executeAndReturnError(&error)
        if let error {
            let code = error[NSAppleScript.errorNumber] as? Int ?? 0
            throw AppIssue(code == -1743
                ? "Shishi is not allowed to control " + (useITerm ? "iTerm2" : "Terminal") + ". Allow it in System Settings → Privacy & Security → Automation."
                : "The agent could not be started: " + ((error[NSAppleScript.errorMessage] as? String) ?? "unknown error"))
        }
        return useITerm ? "iTerm2" : "Terminal"
    }
}
