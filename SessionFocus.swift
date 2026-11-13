import AppKit

/// Brings forward the exact place an agent session runs: an iTerm2 session, a Terminal tab, a tmux pane, or the
/// editor window for the session's folder. Falls back to bringing the app forward. Every identifier is
/// checked again here, because it comes from a file another process wrote.
enum SessionFocus {
    struct Place {
        var iterm = "", tty = "", tmuxPane = "", tmuxSocket = "", cwd = ""

        init(_ object: Any?, cwd: Any?) {
            let value = object as? [String: Any] ?? [:]
            if let id = value["iterm"] as? String, id.range(of: #"^[0-9A-F-]{36}$"#, options: .regularExpression) != nil { iterm = id }
            if let id = value["tty"] as? String, id.range(of: #"^ttys[0-9]{3,4}$"#, options: .regularExpression) != nil { tty = id }
            if let pane = value["tmuxPane"] as? String, pane.range(of: #"^%[0-9]{1,6}$"#, options: .regularExpression) != nil,
               let socket = value["tmuxSocket"] as? String, socket.hasPrefix("/"), socket.count < 300,
               !socket.contains(".."), FileManager.default.fileExists(atPath: socket) {
                tmuxPane = pane; tmuxSocket = socket
            }
            if let path = cwd as? String, path.hasPrefix("/"), path.count < 1024, !path.contains("\0") {
                var folder: ObjCBool = false
                if FileManager.default.fileExists(atPath: path, isDirectory: &folder), folder.boolValue { self.cwd = path }
            }
        }
    }

    static let editors: Set<String> = ["com.microsoft.VSCode", "com.microsoft.VSCodeInsiders", "com.todesktop.230313mzl4w4u92",
                                       "dev.zed.Zed", "com.exafunction.windsurf", "com.vscodium"]

    /// Returns how precisely it found the session: "tab", "pane", "folder" or "app".
    static func focus(bundle: String, place: Place, app: URL) -> String {
        var found = "app"
        if !place.tmuxPane.isEmpty, selectTmux(place) { found = "pane" }
        if bundle == "com.googlecode.iterm2", !place.iterm.isEmpty, run(itermScript(place.iterm)) { return "tab" }
        if bundle == "com.apple.Terminal", !place.tty.isEmpty, run(terminalScript(place.tty)) { return "tab" }
        if editors.contains(bundle), !place.cwd.isEmpty {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            NSWorkspace.shared.open([URL(fileURLWithPath: place.cwd, isDirectory: true)], withApplicationAt: app, configuration: configuration) { _, _ in }
            return "folder"
        }
        let launch = NSWorkspace.OpenConfiguration()
        launch.activates = true
        NSWorkspace.shared.openApplication(at: app, configuration: launch) { _, _ in }
        return found
    }

    private static func itermScript(_ id: String) -> String {
        """
        tell application id "com.googlecode.iterm2"
          repeat with aWindow in windows
            repeat with aTab in tabs of aWindow
              repeat with aSession in sessions of aTab
                if unique id of aSession is "\(id)" then
                  select aWindow
                  tell aTab to select
                  tell aSession to select
                  activate
                  return "found"
                end if
              end repeat
            end repeat
          end repeat
        end tell
        return "missing"
        """
    }

    private static func terminalScript(_ tty: String) -> String {
        """
        tell application id "com.apple.Terminal"
          repeat with aWindow in windows
            repeat with aTab in tabs of aWindow
              if tty of aTab is "/dev/\(tty)" then
                set selected of aTab to true
                set index of aWindow to 1
                activate
                return "found"
              end if
            end repeat
          end repeat
        end tell
        return "missing"
        """
    }

    /// The identifiers were validated in `Place`, so they cannot break out of the script's strings.
    private static func run(_ source: String) -> Bool {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        return error == nil && result?.stringValue == "found"
    }

    private static func selectTmux(_ place: Place) -> Bool {
        guard let tmux = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { return false }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tmux)
        process.arguments = ["-S", place.tmuxSocket, "select-window", "-t", place.tmuxPane, ";", "select-pane", "-t", place.tmuxPane]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return false }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}
