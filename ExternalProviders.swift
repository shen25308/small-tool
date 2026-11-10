import AppKit
import Foundation
import UniformTypeIdentifiers

/// Native boundary between the local UI, system authorization and the bundled account helpers.
/// Only public, explicitly selected fields are returned to WebKit.
final class ExternalProviders {
    typealias Response = [String: Any]
    typealias Callback = (Result<Response, Error>) -> Void

    private let bundledPython: URL
    private let scripts: URL
    private let support: URL
    private let io = DispatchQueue(label: "local.shishi.providers", qos: .utility, attributes: .concurrent)
    // These three properties are accessed on the main queue.
    private var poller: DispatchSourceTimer?
    private var activeConnects = Set<String>()
    private var activeSyncs: [String: [Callback]] = [:]

    init(resources: URL = Bundle.main.resourceURL!) {
        bundledPython = resources.deletingLastPathComponent().appendingPathComponent("MacOS/shishi-python")
        scripts = resources.appendingPathComponent("Mail", isDirectory: true)
        support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ShiShiDesk", isDirectory: true)
    }

    private func hasDefault(_ provider: String) -> Bool {
        let file = scripts.appendingPathComponent("provider-config.json")
        guard let bytes = try? Data(contentsOf: file), bytes.count < 65536,
              let object = try? JSONSerialization.jsonObject(with: bytes) as? Response,
              let section = object[provider] as? Response else { return false }
        let settings = (section["installed"] as? Response) ?? section
        guard let clientID = settings["client_id"] as? String else { return false }
        if provider == "outlook" { return UUID(uuidString: clientID) != nil }
        return clientID.hasSuffix(".apps.googleusercontent.com") && clientID.count > ".apps.googleusercontent.com".count
    }

    private func python() throws -> URL {
        let fm = FileManager.default
        if fm.isExecutableFile(atPath: bundledPython.path) { return bundledPython }
        // Development bundles may use a local interpreter; the release checker rejects this fallback.
        var candidates = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"]
        // Apple's shim can prompt to install developer tools. Use it only with an installed toolchain.
        if fm.fileExists(atPath: "/Library/Developer/CommandLineTools/usr/bin/python3")
            || fm.fileExists(atPath: "/Applications/Xcode.app/Contents/Developer/usr/bin/python3") {
            candidates.append("/usr/bin/python3")
        }
        guard let path = candidates.first(where: {fm.isExecutableFile(atPath: $0)}) else {
            throw AppIssue("The mail and GitHub connectors require Python 3.9 or later.")
        }
        return URL(fileURLWithPath: path)
    }

    /// Always read stdout while the helper runs. Stderr may contain an underlying login URL.
    private func launch(_ script: String, _ args: [String], input: Data?, timeout: Double) throws -> Response {
        let file = scripts.appendingPathComponent(script)
        guard FileManager.default.isReadableFile(atPath: file.path) else { throw AppIssue("This build is missing a connector component.") }
        let process = Process()
        let executable = try python()
        process.executableURL = executable
        let needsVault = script == "bridge.py" && ["connect","sync","disconnect"].contains(args.first ?? "")
        var vault:MailVaultChannel?
        if needsVault {
            guard executable == bundledPython else {throw AppIssue("Mail authorization requires the bundled runtime. Open a complete copy of Shishi.")}
            let accountIndex=args.firstIndex(of:"--account")
            let target=accountIndex.flatMap { $0+1 < args.count ? args[$0+1] : nil }
            vault=try MailVaultChannel(operation:args.first!,target:target,
                                       accounts:support.appendingPathComponent("MailAccounts",isDirectory:true))
        }
        let options = executable == bundledPython ? ["-B","-s"] : ["-B","-E","-s"]
        process.arguments = options + [file.path] + args
        // The launcher supplies the bundled PYTHONHOME. Never inherit a developer PYTHONPATH.
        var environment = ProcessInfo.processInfo.environment.filter { !($0.key.hasPrefix("PYTHON")) }
        environment["PATH"] = ["/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin",environment["PATH"] ?? ""].joined(separator: ":")
        // The environment marker describes the inherited anonymous fd; it does not authorize access.
        environment.removeValue(forKey:"SHISHI_MAIL_PRIVATE_FD")
        if vault != nil {environment["SHISHI_MAIL_PRIVATE_FD"]="2"}
        process.environment = environment
        let output = Pipe()
        let stdin = input.map { _ in Pipe() }
        process.standardInput = stdin?.fileHandleForReading ?? FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = vault?.child ?? FileHandle.nullDevice
        try process.run()
        if let vault { io.async {vault.serve()} }
        let deadline = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global(qos:.utility).asyncAfter(deadline: .now() + timeout, execute:deadline)
        if let bytes=input, let writer=stdin?.fileHandleForWriting {
            io.async {
                try? writer.write(contentsOf: bytes)
                try? writer.close()
            }
        }
        let result = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        deadline.cancel()
        guard result.count <= 2 * 1024 * 1024,
              let object = try? JSONSerialization.jsonObject(with: result) as? Response else {
            throw AppIssue("The connector returned an invalid response. Check the local tools and network connection, then try again.")
        }
        if process.terminationStatus != 0 || (object["ok"] as? Bool) != true {
            throw AppIssue(Self.safeError(object["error"]))
        }
        return object
    }

    private static func safeError(_ value: Any?) -> String {
        guard let message=value as? String, !message.isEmpty, message.count <= 400,
              message.range(of: #"(?:https?://|bearer\s|token[=:]|client[_-]?secret|gh[pousr]_|github_pat_|ya29\.|eyJ[A-Za-z0-9_-]{12})"#,
                            options:[.regularExpression,.caseInsensitive]) == nil else {
            return "The connector could not complete this action. Check its settings and try again."
        }
        return message
    }

    private func run(_ provider: String, _ action: String, body: Response, credentials: Data? = nil) throws -> Response {
        if provider == "github" {
            var request: Response = ["op": action]
            for key in ["repo","workflow"] {
                if let value = body[key] as? String { request[key] = value }
            }
            let data = try JSONSerialization.data(withJSONObject: request)
            let raw = try launch("github_actions.py", [], input: data, timeout: 150)
            var result: Response = [:]
            for key in ["connected","repo","workflow","lastSync","nextSync","created","state","partial"] {
                if let value=raw[key], value is String || value is NSNumber || value is NSNull { result[key]=value }
            }
            if let error=raw["error"] as? String { result["error"] = error.isEmpty ? "" : Self.safeError(error) }
            return result
        }
        var args = [action]
        switch action {
        case "connect":
            args += ["--provider",provider]
            if let sender=body["sender"] as? String {args += ["--sender",sender]}
            if provider == "outlook", let id=body["clientId"] as? String {args += ["--client-id",id]}
            if credentials != nil {args.append("--credentials-stdin")}
        case "disconnect","set-sender":
            guard let id = body["account"] as? String, id.range(of: #"^[a-f0-9]{64}$"#, options:.regularExpression) != nil else {
                throw AppIssue("Select a connected mail account.")
            }
            args += ["--account",id]
            if action == "set-sender" { args += ["--sender",body["sender"] as? String ?? ""] }
            if action == "disconnect", body["purge"] as? Bool == true {args.append("--purge")}
        default: break
        }
        let raw = try launch("bridge.py", args, input: credentials, timeout: action == "connect" ? 430 : 180)
        let publicAccounts: [Response] = (raw["accounts"] as? [Response] ?? []).map { account in
            var row = Response()
            for key in ["id","provider","email","sender","state","lastSync"] {
                if let value = account[key], value is String || value is NSNumber || value is NSNull {row[key] = value}
            }
            if let error = account["error"] as? String { row["error"] = error.isEmpty ? "" : Self.safeError(error) }
            return row
        }
        return ["accounts":publicAccounts, "configuredDefault":hasDefault(provider),
                "connected":publicAccounts.contains { $0["provider"] as? String == provider },
                "created":raw["created"] as? Int ?? 0]
    }

    private func runLater(_ provider:String, _ action:String, body:Response, credentials:Data? = nil, completion:@escaping Callback) {
        io.async {
            let result = Result { try self.run(provider,action,body:body,credentials:credentials) }
            DispatchQueue.main.async { completion(result) }
        }
    }

    /// The Python email helper syncs all connected mailboxes together; combine overlapping requests.
    private func sync(_ provider:String, completion:@escaping Callback) {
        let group = provider == "github" ? "github" : "mail"
        let adjusted: Callback = { outcome in
            completion(outcome.map { value in
                guard group == "mail" else { return value }
                var view = value
                view["connected"] = (view["accounts"] as? [Response] ?? []).contains {$0["provider"] as? String == provider}
                view["configuredDefault"] = self.hasDefault(provider)
                return view
            })
        }
        if activeSyncs[group] != nil { activeSyncs[group]?.append(adjusted); return }
        activeSyncs[group] = [adjusted]
        runLater(provider,"sync",body:[:]) { outcome in
            let callbacks = self.activeSyncs.removeValue(forKey: group) ?? []
            callbacks.forEach {$0(outcome)}
        }
    }

    /// Called from the WKScriptMessageHandler on the main thread.
    func handle(_ body:Response, window:NSWindow?, completion:@escaping Callback) {
        guard let provider=body["provider"] as? String, ["gmail","outlook","github"].contains(provider),
              let action=body["action"] as? String, ["status","connect","sync","disconnect","set-sender"].contains(action),
              action != "set-sender" || provider != "github" else {
            completion(.failure(AppIssue("Unsupported connector action.")));return
        }
        if action == "sync" { sync(provider,completion:completion);return }
        if action != "connect" {runLater(provider,action,body:body,completion:completion);return}
        guard activeConnects.insert(provider).inserted else {
            completion(.failure(AppIssue("This connection is waiting for authorization.")));return
        }
        let done: Callback = { result in
            self.activeConnects.remove(provider)
            completion(result)
        }
        let publicID = (body["clientId"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
        if provider == "outlook" && !publicID.isEmpty && UUID(uuidString:publicID) == nil {
            done(.failure(AppIssue("Enter the UUID registered as the client ID in Microsoft Entra.")));return
        }
        if provider == "github" || (hasDefault(provider) && body["custom"] as? Bool != true) || (provider == "outlook" && !publicID.isEmpty) {
            runLater(provider,action,body:body,completion:done)
            return
        }
        guard let window, window.attachedSheet == nil else {done(.failure(AppIssue("Finish the current action in this window first.")));return}
        if provider == "gmail" {
            let panel=NSOpenPanel()
            panel.title="Choose Google OAuth Client Configuration"
            panel.message="Choose the JSON file exported from Google Cloud for a Desktop app. Shishi uses it on this Mac."
            panel.allowedContentTypes=[.json]
            panel.allowsMultipleSelection=false
            panel.beginSheetModal(for:window) { response in
                guard response == .OK,let url=panel.url else {done(.failure(AppIssue("Connection canceled.")));return}
                self.io.async {
                    let result = Result { () throws -> Response in
                        let handle=try FileHandle(forReadingFrom:url)
                        defer {try? handle.close()}
                        let data=try handle.read(upToCount:65537) ?? Data()
                        guard data.count <= 65536, let json=try? JSONSerialization.jsonObject(with:data) as? Response,
                              json["installed"] is Response else {throw AppIssue("Choose a valid Google Desktop app client JSON file.")}
                        return try self.run(provider,action,body:body,credentials:data)
                    }
                    DispatchQueue.main.async {done(result)}
                }
            }
        } else {
            let alert=NSAlert()
            alert.messageText="Connect Outlook"
            alert.informativeText="Enter the public client ID of your Microsoft Entra desktop app."
            let field=NSTextField(frame:NSRect(x:0,y:0,width:340,height:26))
            field.placeholderString="Application (client) ID"
            alert.accessoryView=field
            alert.addButton(withTitle:"Continue");alert.addButton(withTitle:"Cancel")
            alert.window.initialFirstResponder=field
            alert.beginSheetModal(for:window) { response in
                guard response == .alertFirstButtonReturn else {done(.failure(AppIssue("Connection canceled.")));return}
                let id=field.stringValue.trimmingCharacters(in:.whitespacesAndNewlines)
                guard UUID(uuidString:id) != nil else {done(.failure(AppIssue("Enter the UUID registered as the client ID in Microsoft Entra.")));return}
                var request=body;request["clientId"]=id
                self.runLater(provider,action,body:request,completion:done)
            }
        }
    }

    func startPolling(onDelivery:@escaping () -> Void) {
        guard poller == nil else {return}
        let timer=DispatchSource.makeTimerSource(queue:.main)
        timer.schedule(deadline:.now()+3,repeating:.seconds(120),leeway:.seconds(8))
        timer.setEventHandler { [weak self] in
            guard let self else {return}
            let mailDir=self.support.appendingPathComponent("MailAccounts")
            let mailFiles=(try? FileManager.default.contentsOfDirectory(atPath:mailDir.path)) ?? []
            let githubFile=self.support.appendingPathComponent("GitHubActions.json")
            let targets=(mailFiles.contains(where:{$0.hasSuffix(".json")}) ? ["gmail"] : [])
                + (FileManager.default.fileExists(atPath:githubFile.path) ? ["github"] : [])
            for target in targets {
                self.sync(target) { result in
                    if case .success(let publicState)=result, (publicState["created"] as? Int ?? 0) > 0 {onDelivery()}
                }
            }
        }
        poller=timer
        timer.resume()
    }
}
