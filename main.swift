import AppKit
import CryptoKit
import WebKit
import UniformTypeIdentifiers

struct Entry: Codable {
    let id, title, project, tag, priority, planned, source, quote: String
    let done: Bool
    let dueDate, dueTime: String?
}
struct DeadlineReminder: Equatable {
    let id, title, summary, date: String
    private static let clock: DateFormatter = {
        let clock = DateFormatter()
        clock.locale = Locale(identifier:"en_US_POSIX")
        clock.calendar = Calendar(identifier:.gregorian)
        clock.timeZone = .autoupdatingCurrent
        clock.dateFormat = "yyyy-MM-dd HH:mm"
        clock.isLenient = false
        return clock
    }()
    private static let parser: DateFormatter = {
        let formatter = clock.copy() as! DateFormatter
        formatter.timeZone = TimeZone(secondsFromGMT:0)
        return formatter
    }()

    init?(_ task:Entry) {
        guard !task.done,let day=task.dueDate, !day.isEmpty else {return nil}
        let time=task.dueTime ?? ""
        date=day+" "+(time.isEmpty ? "00:00" : time)
        // Compare local calendar minutes. This also catches a deadline after sleep or a relaunch.
        guard let parsed=Self.parser.date(from:date), Self.parser.string(from:parsed)==date else {return nil}
        let key=task.id+"\0"+day+"\0"+time
        id=SHA256.hash(data:Data(key.utf8)).map{String(format:"%02x",$0)}.joined()
        var clean=task.title.components(separatedBy:.controlCharacters).joined(separator:" ").trimmingCharacters(in:.whitespacesAndNewlines)
        while clean.utf8.count>640 {clean.removeLast()}
        title=clean.isEmpty ? "Task deadline" : clean
        summary="Due on "+day+(time.isEmpty ? "." : " at "+time+" (local time).")
    }
    static func localMinute(_ now:Date) -> String {clock.string(from:now)}
}
struct Workspace: Codable {
    let version: Int
    let projects: [String]
    let tasks: [Entry]
    func validate() throws {
        guard version == 1, !projects.isEmpty, Set(projects).count == projects.count,
              Set(tasks.map(\.id)).count == tasks.count,
              tasks.allSatisfy({projects.contains($0.project) && !$0.title.isEmpty}) else {
            throw AppIssue("Invalid workspace data.")
        }
    }
}
private final class WindowTitleStrip: NSView {
    // Let the system title bar handle dragging and double-clicks outside the buttons.
    override func hitTest(_ point:NSPoint) -> NSView? {
        let view = super.hitTest(point)
        return view === self || view is NSTextField || view is NSStackView ? nil : view
    }
}
final class Host: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var compact = false
    private lazy var card = CornerCard()
    private lazy var hotkeys = GlobalHotkeys { [weak self] action in self?.hotkey(action) }
    private let keepAwake = KeepAwake()
    private let alerts = Alerts()
    private lazy var eventKit = EventKitBridge()
    private var hotkeysOn: Bool { UserDefaults.standard.object(forKey:"ShiShiHotkeys") as? Bool ?? true }
    private var keepAwakeOn: Bool { UserDefaults.standard.bool(forKey:"ShiShiKeepAwake") }
    private var takenShortcuts: [String] = []
    private var agentsWorking = false
    /// ⌃⌥Space shows or hides the card from any app; ⌃⌥N shows it with the add field ready, without
    /// taking focus from the app you were in until you type.
    private func hotkey(_ action: GlobalHotkeys.Action) {
        switch action {
        case .toggleCard:
            if compact && card.panel.isVisible { card.panel.orderOut(nil) }
            else if compact { card.show(pinned:pinned) }
            else { setCompact(true) }
        case .quickAdd:
            if !compact { setCompact(true) } else if !card.panel.isVisible { card.show(pinned:pinned) }
            card.panel.makeKeyAndOrderFront(nil)
            tell("focusQuickAdd",true)
        }
    }
    private func settingsState() -> [String:Any] {
        ["hotkeys":hotkeysOn,"hotkeyLabels":GlobalHotkeys.labels.sorted {$0.key.rawValue < $1.key.rawValue}.map(\.value),
         "takenShortcuts":takenShortcuts,"keepAwake":keepAwakeOn,"keepingAwake":keepAwake.holding,
         "usage":UserDefaults.standard.object(forKey:"ShiShiShowUsage") as? Bool ?? true]
    }
    private var mainBackdrop: NSVisualEffectView!
    // Off unless chosen: a window that floats above everything is a deliberate preference.
    private var pinned = UserDefaults.standard.object(forKey:"ShiShiTodayPinned") as? Bool ?? false
    private let modeButton = NSButton()
    private let pinButton = NSButton()
    private let titleStrip = WindowTitleStrip()
    private let caption = NSTextField(labelWithString:"My Notes")
    private var captionPosition: NSLayoutConstraint!
    private var startsWithToday: Bool {
        let args = CommandLine.arguments
        if args.contains("--open-inbox") || args.contains("--workspace") {return false}
        return args.contains("--compact-workspace") || (UserDefaults.standard.object(forKey:"ShiShiTodayMode") as? Bool ?? true)
    }
    private var ready = false
    private var pendingSource: String?
    private var pendingURLs: [[String:String]] = []
    /// shishi://add?text=Call%20the%20bank%20tomorrow%203pm (&notes=…&list=…), shishi://show-card,
    /// shishi://open?view=today|upcoming|all|done|inbox, shishi://search?q=…
    /// A link can add a task or show something, never change or delete existing data.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls.prefix(10) where url.scheme == "shishi" {
            let action=url.host ?? ""
            var fields:[String:String]=["action":action]
            for item in URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? [] where ["text","title","notes","list","view","q"].contains(item.name) {
                fields[item.name]=String((item.value ?? "").prefix(item.name=="notes" ? 4000 : 400))
            }
            switch action {
            case "show-card": if !compact {setCompact(true)} else {card.show(pinned:pinned)}
            case "add","open","search","inbox":
                if action != "add" {openWorkspace(inbox:false)}
                guard ready else {pendingURLs.append(fields);continue}
                tell("openURLAction",fields)
            default: break
            }
        }
    }
    private var processing = false
    private let inboxQueue = DispatchQueue(label:"local.shishi.codex-inbox",qos:.utility)
    private var inboxTimer: DispatchSourceTimer?
    // All access after initialization is serialized on inboxQueue.
    private lazy var codexEnabled:Bool = {
        if let flag=UserDefaults.standard.object(forKey:"ShiShiCodexEnabled") as? Bool {return flag}
        return FileManager.default.fileExists(atPath:file.deletingLastPathComponent().appendingPathComponent("CodexInbox.json").path)
    }()
    private var didSendPausedSnapshot=false
    private var lastExternalRows: [[String:Any]] = []
    private var lastInboxErrors: [String:String] = [:]
    private var reminders: [DeadlineReminder] = []
    private var deliveredReminders: Set<String> = []
    private lazy var inbox = CodexInbox(
        root: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex"),
        store: file.deletingLastPathComponent().appendingPathComponent("CodexInbox.json")
    )
    private lazy var externalInbox = ConnectorInbox(directory: file.deletingLastPathComponent().appendingPathComponent("Incoming", isDirectory:true))
    private lazy var agentBoard = AgentBoard(directory: file.deletingLastPathComponent().appendingPathComponent("Agents", isDirectory:true))
    private lazy var approvals = ApprovalBoard(directory: file.deletingLastPathComponent().appendingPathComponent("Approvals", isDirectory:true))
    private func scanApprovals() {
        let rows=approvals.pending()
        DispatchQueue.main.async { self.tell("setApprovals",rows) }
    }
    private var watchers: [DirectoryWatcher] = []
    private let menuBar = MenuBarStatus()
    private var unreadByChannel: [String:Int] = [:]
    private var vibrant = false
    private func updateReminders(_ workspace:Workspace) {
        let checkNow = ready
        inboxQueue.async {
            let updated = workspace.tasks.compactMap(DeadlineReminder.init)
            guard self.reminders != updated else {return}
            self.reminders = updated
            self.deliveredReminders.formIntersection(self.reminders.map(\.id))
            if checkNow {self.scanInboxes()}
        }
    }
    private func postDueReminders() -> String? {
        let now = DeadlineReminder.localMinute(Date())
        var problem: String?
        for task in reminders where task.date <= now && !deliveredReminders.contains(task.id) {
            do {
                try externalInbox.receive(source:"Reminders",title:task.title,summary:task.summary,eventID:task.id)
                deliveredReminders.insert(task.id)
                // Only a deadline that just arrived makes a sound; reopening Shishi after a week stays quiet.
                if task.date >= DeadlineReminder.localMinute(Date().addingTimeInterval(-600)) {
                    let alerts=self.alerts
                    DispatchQueue.main.async {alerts.taskDue(title:task.title,summary:task.summary,id:task.id)}
                }
            } catch { problem = error.localizedDescription }
        }
        return problem
    }
    // These readers keep separate cursors and error states. A missing provider cannot block another.
    private func pushInbox(_ channel:String, warning:String? = nil, scan:() throws -> (items:[[String:Any]],changed:Bool)) {
        do {
            let update=try scan()
            let errorChanged = lastInboxErrors[channel] != warning
            lastInboxErrors[channel] = warning
            if update.changed || errorChanged {
                DispatchQueue.main.async {self.tell("setInbox",["channel":channel,"items":update.items,"error":warning ?? ""])}
            }
        } catch {
            let message=error.localizedDescription
            if lastInboxErrors[channel] != message {
                lastInboxErrors[channel]=message
                DispatchQueue.main.async {self.tell("setInbox",["channel":channel,"error":message])}
            }
        }
    }
    private func scanInboxes(force:Bool = false) {
        pushInbox("codex") {
            guard codexEnabled else {
                let send=force || !didSendPausedSnapshot
                didSendPausedSnapshot=true
                return (send ? CodexInbox.wire(try inbox.storedNotices()) : [],send)
            }
            let update=try inbox.scan()
            let send=force || update.changed || lastInboxErrors["codex"] != nil
            return (send ? CodexInbox.wire(update.notices) : [],send)
        }
        scanExternal(force:force)
        scanAgents(force:force)
    }
    private func scanExternal(force:Bool = false) {
        pushInbox("external",warning:postDueReminders()) {
            let update=try externalInbox.scan()
            let send=force || update.changed || lastInboxErrors["external"] != nil
            if send {lastExternalRows=ConnectorInbox.wire(update.notices)}
            return (lastExternalRows,send)
        }
    }
    private func scanAgents(force:Bool = false) {
        let update=agentBoard.scan()
        let waiting=update.items.filter {$0.state=="attention"}.map {(key:$0.key,title:$0.title,detail:$0.detail)}
        DispatchQueue.main.async {self.alerts.agentsWaiting(waiting)}
        guard force || update.changed else {return}
        let rows=AgentBoard.wire(update.items)
        let working=update.items.contains {$0.state=="working"}
        DispatchQueue.main.async {
            self.agentsWorking=working
            self.keepAwake.update(working:working && self.keepAwakeOn)
            self.menuBar.update(agents:update.items)
            self.tell("setAgents",rows)
        }
    }
    private func startInbox() {
        guard inboxTimer == nil else {return}
        _ = inbox
        _ = codexEnabled
        _ = externalInbox
        _ = agentBoard
        let timer=DispatchSource.makeTimerSource(queue:inboxQueue)
        timer.schedule(deadline:.now(),repeating:.seconds(10),leeway:.seconds(1))
        timer.setEventHandler { [weak self] in
            self?.approvals.heartbeat()
            self?.scanInboxes()
            self?.scanApprovals()
        }
        inboxTimer=timer
        timer.resume()
        // Hooks publish by adding a file. Watching the folders shows a result as soon as it lands.
        let base=file.deletingLastPathComponent()
        watchers=[
            DirectoryWatcher(url:base.appendingPathComponent("Agents",isDirectory:true),queue:inboxQueue) { [weak self] in self?.scanAgents() },
            DirectoryWatcher(url:base.appendingPathComponent("Approvals",isDirectory:true),queue:inboxQueue) { [weak self] in self?.scanApprovals() },
            DirectoryWatcher(url:base.appendingPathComponent("Incoming",isDirectory:true),queue:inboxQueue) { [weak self] in self?.scanExternal() }
        ]
    }
    private let file: URL
    private lazy var providers = ExternalProviders(resources:resources)
    private var storeUnreadable = false
    private let resources = Bundle.main.resourceURL!
    /// The light download leaves out the offline model, and with it task capture from messages.
    private let inference = Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/Inference")
    /// The bundled model, or one downloaded and verified into Application Support by the light app.
    private var modelURL: URL? {
        [resources.appendingPathComponent("assistant.gguf"),ModelDownload.installed].first {FileManager.default.fileExists(atPath:$0.path)}
    }
    private var hasEngine: Bool { FileManager.default.isExecutableFile(atPath:inference.appendingPathComponent("llama-completion").path) }
    private var hasModel: Bool { hasEngine && modelURL != nil }
    private let modelDownload = ModelDownload()
    private var capabilities: [String:Any] {
        ["capture":hasModel,"canDownloadModel":hasEngine && modelURL == nil,"downloading":modelDownload.running]
    }

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = support.appendingPathComponent("ShiShiDesk/Workspace.json")
        super.init()
    }
    private static let appearances = ["system","light","dark"]
    private func applyAppearance(_ name:String) {
        NSApp.appearance = name == "dark" ? NSAppearance(named:.darkAqua) : name == "light" ? NSAppearance(named:.aqua) : nil
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // "--appearance dark" overrides the saved choice for one launch, e.g. for screenshots.
        let args = CommandLine.arguments
        let forced = args.firstIndex(of:"--appearance").flatMap { $0+1 < args.count ? args[$0+1] : nil }
        applyAppearance(forced.flatMap { Host.appearances.contains($0) ? $0 : nil }
                        ?? UserDefaults.standard.string(forKey:"ShiShiAppearance") ?? "system")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "host")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.underPageBackgroundColor = .windowBackgroundColor
        let style:NSWindow.StyleMask = [.titled,.closable,.miniaturizable,.resizable,.fullSizeContentView]
        let display = NSScreen.main?.visibleFrame.size ?? NSSize(width:760,height:800)
        let frame=NSRect(x:0,y:0,width:min(760,display.width),height:min(800,display.height))
        window = NSWindow(contentRect:NSWindow.contentRect(forFrameRect:frame,styleMask:style),styleMask:style,backing:.buffered,defer:false)
        window.title = "My Notes"
        window.backgroundColor = .windowBackgroundColor
        window.titlebarSeparatorStyle = .none
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 635,height: 420)
        window.isReleasedWhenClosed = false
        window.delegate = self
        // The sidebar shows the desktop through the system sidebar material, like Finder and Reminders.
        let backdrop = NSVisualEffectView()
        backdrop.material = .sidebar
        backdrop.blendingMode = .behindWindow
        backdrop.state = .followsWindowActiveState
        window.contentView = backdrop
        mainBackdrop = backdrop
        web.frame = backdrop.bounds
        web.autoresizingMask = [.width,.height]
        backdrop.addSubview(web)
        // WebKit paints an opaque page unless this switch exists. Without it the page keeps a solid sidebar.
        if web.responds(to:NSSelectorFromString("_setDrawsBackground:")) {
            web.setValue(false,forKey:"drawsBackground")
            web.underPageBackgroundColor = .clear
            vibrant = true
        }
        menuBar.onOpen = { [weak self] inbox in self?.openWorkspace(inbox:inbox) }
        menuBar.update(agents:[])
        addWindowControls()
        window.center()
        window.setFrameAutosaveName("ShiShiTallWorkspace")
        NSApplication.shared.servicesProvider = self
        makeMenu()
        takenShortcuts=hotkeys.setEnabled(hotkeysOn)
        let ui = resources.appendingPathComponent("UI",isDirectory:true)
        web.loadFileURL(ui.appendingPathComponent("index.html"),allowingReadAccessTo: ui)
        if !startsWithToday {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {
        openWorkspace(inbox:false);return true
    }
    private func openWorkspace(inbox:Bool) {
        if compact {setCompact(false)}
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        if inbox {tell("openInbox","main")}
    }
    func applicationWillTerminate(_ notification: Notification) {
        // A permission request must never wait for a Shishi that has quit.
        approvals.closed()
    }
    // With the menu bar item on, Shishi keeps collecting results after its window closes.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { !menuBar.enabled }
    func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.isFileURL, url.lastPathComponent=="index.html" { decisionHandler(.allow) }
        else { decisionHandler(.cancel) }
    }
    @objc private func showSettings() {
        if compact {setCompact(false)}
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        tell("openSettings","agents")
    }
    /// The About panel names the exact source commit, so a build can be matched to its documentation (F18).
    @objc private func showAbout() {
        let info=Bundle.main.infoDictionary ?? [:]
        let commit=(info["ShishiSourceCommit"] as? String).map {String($0.prefix(12))} ?? "unknown"
        let dirty=(info["ShishiSourceDirty"] as? Bool) == true ? " (with local changes)" : ""
        let light=(info["ShishiVariant"] as? String) == "light"
        let variant=(light ? "Light download" : "Full download")+(hasModel ? ", offline model installed" : ", no offline model")
        let credits=NSAttributedString(string:"Source commit \(commit)\(dirty)\n\(variant)",
            attributes:[.font:NSFont.systemFont(ofSize:11),.foregroundColor:NSColor.secondaryLabelColor])
        NSApp.activate(ignoringOtherApps:true)
        NSApp.orderFrontStandardAboutPanel(options:[.credits:credits])
    }
    private func makeMenu() {
        let bar=NSMenu()
        let appItem=NSMenuItem()
        bar.addItem(appItem)
        let appMenu=NSMenu(title:"Shishi")
        appMenu.addItem(withTitle:"About Shishi",action:#selector(showAbout),keyEquivalent:"")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:"Settings…",action:#selector(showSettings),keyEquivalent:",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:"Hide Shishi",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:"Quit Shishi",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        appItem.submenu=appMenu
        let editItem=NSMenuItem()
        let edit=NSMenu(title:"Edit")
        for (name,selector,key) in [("Undo","undo:","z"),("Redo","redo:","Z"),("Cut","cut:","x"),("Copy","copy:","c"),("Paste","paste:","v"),("Select All","selectAll:","a")] {
            edit.addItem(withTitle:name,action:Selector(selector),keyEquivalent:key)
        }
        bar.addItem(editItem)
        editItem.submenu=edit
        let workItem=NSMenuItem()
        let work=NSMenu(title:"Workspace")
        let capture=work.addItem(withTitle:"Extract Tasks from a Message",action:#selector(captureMenu),keyEquivalent:"k")
        capture.target=self
        let mode=work.addItem(withTitle:"Switch Between Today and Workspace",action:#selector(toggleCompact),keyEquivalent:"p")
        mode.target=self
        bar.addItem(workItem)
        workItem.submenu=work
        NSApp.mainMenu=bar
    }
    private func addWindowControls() {
        window.titleVisibility = .hidden
        caption.font = .systemFont(ofSize:12,weight:.semibold)
        caption.textColor = .secondaryLabelColor
        caption.translatesAutoresizingMaskIntoConstraints = false
        caption.setAccessibilityElement(false)
        // The page shows its own large title, as Reminders and Notes do. The window title stays for Mission Control and accessibility.
        caption.isHidden = true
        titleStrip.addSubview(caption)
        let strip = NSStackView(views:[modeButton,pinButton])
        strip.orientation = .horizontal
        strip.alignment = .centerY
        strip.spacing = 5
        strip.edgeInsets = NSEdgeInsets(top:0,left:2,bottom:0,right:8)
        strip.translatesAutoresizingMaskIntoConstraints = false
        titleStrip.addSubview(strip)
        for button in [modeButton,pinButton] {
            button.controlSize = .small
            button.bezelStyle = .inline
            button.isBordered = false
            button.font = .systemFont(ofSize:11, weight:.medium)
            button.target = self
        }
        modeButton.imagePosition = .imageOnly
        modeButton.action = #selector(toggleCompact)
        pinButton.imagePosition = .imageLeading
        pinButton.action = #selector(togglePinned)
        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .right
        accessory.view = titleStrip
        captionPosition = caption.centerXAnchor.constraint(equalTo:titleStrip.leadingAnchor)
        NSLayoutConstraint.activate([
            captionPosition,
            caption.centerYAnchor.constraint(equalTo:titleStrip.centerYAnchor),
            strip.trailingAnchor.constraint(equalTo:titleStrip.trailingAnchor),
            strip.centerYAnchor.constraint(equalTo:titleStrip.centerYAnchor)
        ])
        layoutWindowTitle()
        window.addTitlebarAccessoryViewController(accessory)
        updateWindowControls()
    }
    private func layoutWindowTitle() {
        guard captionPosition != nil else {return}
        let width = window.frame.width
        let leading:CGFloat = 82
        titleStrip.setFrameSize(NSSize(width:max(1,width-leading),height:24))
        captionPosition.constant = width/2-leading
    }
    func windowDidResize(_ notification:Notification) {layoutWindowTitle()}
    private func updateWindowControls() {
        let small = NSImage.SymbolConfiguration(pointSize:11,weight:.medium)
        modeButton.image = NSImage(systemSymbolName:compact ? "sidebar.leading" : "rectangle.portrait",accessibilityDescription:nil)?.withSymbolConfiguration(small)
        modeButton.toolTip = compact ? "Open full workspace" : "Show floating Today list"
        modeButton.setAccessibilityLabel(modeButton.toolTip)
        pinButton.title = pinned ? "Pinned" : "Pin"
        pinButton.image = NSImage(systemSymbolName:pinned ? "pin.fill" : "pin",accessibilityDescription:nil)?.withSymbolConfiguration(small)
        pinButton.toolTip = pinned ? "Turn off always on top" : "Keep Today above other windows"
        pinButton.setAccessibilityLabel(pinButton.toolTip)
        pinButton.isHidden = !compact
    }
    @objc private func togglePinned() {
        pinned.toggle()
        UserDefaults.standard.set(pinned,forKey:"ShiShiTodayPinned")
        card.setPinned(pinned)
        updateWindowControls()
        tell("setPinned",pinned)
    }
    private func tell(_ function: String, _ arg: Any) {
        if function=="setInbox", let state=arg as? [String:Any],let rows=state["items"] as? [[String:Any]],let channel=state["channel"] as? String {
            unreadByChannel[channel]=rows.filter {($0["read"] as? Bool) != true}.count
            menuBar.update(unread:unreadByChannel.values.reduce(0,+))
        }
        web.callAsyncJavaScript("window[fn](value);",arguments:["fn":function,"value":arg],in:nil,in:.page,completionHandler:nil)
    }
    @objc private func toggleCompact() { setCompact(!compact) }
    /// Compact mode moves the one web view into the corner card, so both views share the same page state.
    private func setCompact(_ enabled: Bool) {
        guard compact != enabled else { return }
        compact = enabled
        UserDefaults.standard.set(enabled,forKey:"ShiShiTodayMode")
        updateWindowControls()
        if enabled {
            card.attach(web)
            card.show(pinned:pinned)
            window.orderOut(nil)
        } else {
            web.removeFromSuperview()
            web.layer?.cornerRadius = 0
            web.frame = mainBackdrop.bounds
            web.autoresizingMask = [.width,.height]
            mainBackdrop.addSubview(web)
            card.panel.orderOut(nil)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps:true)
        }
        tell("setCompact",enabled)
    }
    @objc private func captureMenu(){ receive("") }
    @objc func captureWork(_ board: NSPasteboard, userData: String?, error errorPtr: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text=board.string(forType:.string),!text.isEmpty else { errorPtr.pointee="Select some text first.";return }
        guard text.count<=2400 else { errorPtr.pointee="Select up to 2,400 characters at a time.";return }
        receive(text)
    }
    @objc func collectAIResult(_ board:NSPasteboard,userData:String?,error errorPtr:AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let input=board.string(forType:.string)?.trimmingCharacters(in:.whitespacesAndNewlines),
              !input.isEmpty else {errorPtr.pointee="Select the reply text to add to your inbox.";return}
        let title=input.split(whereSeparator: { $0.isNewline }).first.map(String.init) ?? "AI reply"
        let reader=externalInbox
        do {
            try inboxQueue.sync {
                _ = try reader.receive(source:"Manual capture",title:String(title.prefix(72)),summary:input)
                scanInboxes(force:true)
            }
        } catch {errorPtr.pointee=error.localizedDescription as NSString}
    }
    private func receive(_ text: String){
        guard ready else {pendingSource=text;return}
        if compact {setCompact(false)}
        NSApp.activate(ignoringOtherApps:true)
        window.makeKeyAndOrderFront(nil)
        tell("openMessage",text)
    }
    private func markNotice(_ key:String,channel:String,request:String?=nil) {
        let codex=inbox, external=externalInbox
        inboxQueue.async {
            do {
                let items=channel=="external" ? try ConnectorInbox.wire(external.markRead(key)) : try CodexInbox.wire(codex.markRead(key))
                DispatchQueue.main.async {
                    self.tell("setInbox",["channel":channel,"items":items,"error":""])
                    if let request {self.reply(request,true,items)}
                }
            } catch {
                if let request {DispatchQueue.main.async {self.reply(request,false,error.localizedDescription)}}
            }
        }
    }
    private func reply(_ id:String, _ ok:Bool, _ value:Any){
        web.callAsyncJavaScript("window.hostReply(id,ok,value);",arguments:["id":id,"ok":ok,"value":value],in:nil,in:.page,completionHandler:nil)
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL==true,
              let body=message.body as? [String:Any],let id=body["id"] as? String,let op=body["op"] as? String else{return}
        do {
            switch op {
            case "load":
                if FileManager.default.fileExists(atPath:file.path) {
                    do{
                        let bytes=try Data(contentsOf:file)
                        let state=try JSONDecoder().decode(Workspace.self,from:bytes)
                        try state.validate()
                        updateReminders(state)
                        reply(id,true,try JSONSerialization.jsonObject(with:bytes))
                    }catch{storeUnreadable=true;throw error}
                }else{reply(id,true,NSNull())}
            case "save":
                guard !storeUnreadable,let state=body["state"] else{throw AppIssue("The task list could not be saved.")}
                let bytes=try JSONSerialization.data(withJSONObject:state,options:[.sortedKeys])
                let workspace=try JSONDecoder().decode(Workspace.self,from:bytes)
                try workspace.validate()
                try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true)
                try bytes.write(to:file,options:.atomic)
                updateReminders(workspace)
                reply(id,true,true)
            case "downloadModel":
                // Optional, only on request: fetch the pinned model, verify it, then turn on capture.
                if body["cancel"] as? Bool == true {modelDownload.cancel();reply(id,true,true);break}
                guard hasEngine else {throw AppIssue("This build has no inference engine, so a model cannot be used.")}
                guard modelURL == nil else {reply(id,true,true);break}
                modelDownload.start { [weak self] event in
                    guard let self else {return}
                    switch event {
                    case .progress(let received,let total): self.tell("modelProgress",["state":"downloading","received":received,"total":total])
                    case .verifying: self.tell("modelProgress",["state":"verifying"])
                    case .finished: self.tell("setCapabilities",self.capabilities);self.tell("modelProgress",["state":"installed"])
                    case .failed(let message): self.tell("modelProgress",["state":"failed","message":message]);self.tell("setCapabilities",self.capabilities)
                    }
                }
                tell("setCapabilities",capabilities)
                reply(id,true,true)
            case "snapshotWorkspace":
                // Keep a dated copy of the current workspace before a backup replaces it.
                guard FileManager.default.fileExists(atPath:file.path) else {reply(id,true,"");break}
                let folder=file.deletingLastPathComponent().appendingPathComponent("Backups",isDirectory:true)
                try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
                let stamp=ISO8601DateFormatter.string(from:Date(),timeZone:.current,formatOptions:[.withFullDate,.withTime,.withDashSeparatorInDate]).replacingOccurrences(of:":",with:".")
                let copy=folder.appendingPathComponent("Workspace before import "+stamp+".json")
                try? FileManager.default.removeItem(at:copy)
                try FileManager.default.copyItem(at:file,to:copy)
                reply(id,true,copy.path)
            case "exportBackup":
                guard let text=body["text"] as? String, !text.isEmpty, text.utf8.count <= 20_000_000 else {throw AppIssue("There is nothing to back up.")}
                let panel=NSSavePanel()
                panel.title="Back Up Shishi"
                panel.nameFieldStringValue=(body["name"] as? String) ?? "Shishi Backup.json"
                panel.allowedContentTypes=[.json]
                panel.canCreateDirectories=true
                NSApp.activate(ignoringOtherApps:true)
                panel.begin { [weak self] answer in
                    guard answer == .OK, let url=panel.url else {self?.reply(id,true,"");return}
                    do {try Data(text.utf8).write(to:url,options:.atomic);self?.reply(id,true,url.path)}
                    catch {self?.reply(id,false,"The backup could not be saved: "+error.localizedDescription)}
                }
            case "importBackup":
                let panel=NSOpenPanel()
                panel.title="Import a Shishi Backup"
                panel.allowedContentTypes=[.json]
                panel.allowsMultipleSelection=false
                panel.canChooseDirectories=false
                NSApp.activate(ignoringOtherApps:true)
                panel.begin { [weak self] answer in
                    guard answer == .OK, let url=panel.url else {self?.reply(id,true,NSNull());return}
                    guard let size=try? url.resourceValues(forKeys:[.fileSizeKey]).fileSize, size <= 20_000_000,
                          let bytes=try? Data(contentsOf:url), let text=String(data:bytes,encoding:.utf8) else {
                        self?.reply(id,false,"This file could not be read as a Shishi backup.");return
                    }
                    self?.reply(id,true,["name":url.lastPathComponent,"text":text])
                }
            case "ready":
                ready=true
                if startsWithToday {
                    setCompact(true)
                }
                startInbox()
                providers.startPolling { [weak self] in
                    self?.inboxQueue.async { [weak self] in self?.scanInboxes(force:true) }
                }
                tell("setPinned",pinned)
                tell("setCapabilities",capabilities)
                // The page pads its top edge by the title bar height because content runs underneath it.
                tell("setChrome",["titlebar":Double(max(0,window.frame.height-window.contentLayoutRect.height)),"vibrant":vibrant] as [String:Any])
                if CommandLine.arguments.contains("--open-inbox") {
                    tell("openInbox",true)
                }
                // "--show schedule" or "--show connections" opens that sheet, for screenshots of the real window.
                let launchArgs=CommandLine.arguments
                if let at=launchArgs.firstIndex(of:"--show"), at+1 < launchArgs.count {
                    tell("showForCapture",launchArgs[at+1])
                }
                reply(id,true,true)
                if let text=pendingSource{pendingSource=nil;receive(text)}
                for fields in pendingURLs {tell("openURLAction",fields)}
                pendingURLs=[]
            case "syncInboxes":
                inboxQueue.async {
                    self.scanInboxes(force:true)
                    DispatchQueue.main.async {self.reply(id,true,true)}
                }
            case "noticeState":
                guard let key=body["key"] as? String else {throw AppIssue("The message ID is missing.")}
                let channel=body["channel"] as? String ?? "codex"
                let read=body["read"] as? Bool, archived=body["archived"] as? Bool
                let codex=inbox, external=externalInbox
                inboxQueue.async {
                    do {
                        let items=channel=="external" ? try ConnectorInbox.wire(external.setState(key,read:read,archived:archived))
                                                      : try CodexInbox.wire(codex.setState(key,read:read,archived:archived))
                        DispatchQueue.main.async {
                            self.tell("setInbox",["channel":channel,"items":items,"error":""])
                            self.reply(id,true,true)
                        }
                    } catch {DispatchQueue.main.async {self.reply(id,false,error.localizedDescription)}}
                }
            case "readNotice":
                guard let key=body["key"] as? String else {throw AppIssue("The message ID is missing.")}
                markNotice(key,channel:body["channel"] as? String ?? "codex",request:id)
            case "codexConnection":
                let requested=body["enabled"] as? Bool
                inboxQueue.async {
                    do {
                        if let enabled=requested, enabled != self.codexEnabled {
                            if enabled {try self.inbox.startInterval()}
                            self.codexEnabled=enabled
                            self.didSendPausedSnapshot=false
                            UserDefaults.standard.set(enabled,forKey:"ShiShiCodexEnabled")
                            self.scanInboxes(force:true)
                        }
                        let enabled=self.codexEnabled
                        DispatchQueue.main.async {self.reply(id,true,enabled)}
                    } catch {DispatchQueue.main.async {self.reply(id,false,error.localizedDescription)}}
                }
            case "externalProvider":
                providers.handle(body,window:window) { [weak self] result in
                    guard let self else {return}
                    switch result {
                    case .success(let response):
                        self.reply(id,true,response)
                        if body["action"] as? String != "status" {
                            self.inboxQueue.async {self.scanInboxes(force:true)}
                        }
                    case .failure(let error):self.reply(id,false,error.localizedDescription)
                    }
                }
            case "openConnectorLink":
                guard let key=body["key"] as? String else {throw AppIssue("The message ID is missing.")}
                inboxQueue.async {
                    do {
                        let rows=self.lastExternalRows
                        guard let row=rows.first(where:{$0["id"] as? String == key}),
                              let link=row["link"] as? String, let source=row["source"] as? String,
                              let url=ConnectorInbox.safeLink(link,source:source) else {throw AppIssue("This message has no valid link to the original conversation.")}
                        DispatchQueue.main.async {
                            let opened=NSWorkspace.shared.open(url)
                            self.reply(id,opened,opened ? "Opened" : "This link could not be opened.")
                        }
                    } catch {DispatchQueue.main.async {self.reply(id,false,error.localizedDescription)}}
                }
            case "copyConnectorSetup":
                let dir=resources.appendingPathComponent("Connectors")
                let runtime=resources.deletingLastPathComponent().appendingPathComponent("MacOS/shishi-python").path
                let setup:String
                switch body["kind"] as? String {
                case "grokBot":
                    let sender=dir.appendingPathComponent("shishi-send.py").path
                    setup="""
                    When the task is complete, use Grok Bot’s local execution on this Mac to deliver the final result to the Shishi inbox. Run the script below with Shishi’s bundled Python. Pass the task title as --title and a stable ID for this task as --event-id. Write the final summary to standard input as plain text. Use an argument list and standard input to pass the actual content. A zero exit status confirms delivery.
                    Interpreter path: \(runtime)
                    Script path: \(sender)
                    Arguments: --source "Grok Bot" --title <task title> --event-id <task ID>
                    """
                case "mcp":
                    let path=dir.appendingPathComponent("shishi-mcp.py").path
                    let data=try JSONSerialization.data(withJSONObject:["mcpServers":["shishi":["command":runtime,"args":["-B",path,"--source","Local AI"]]]],options:[.prettyPrinted,.sortedKeys,.withoutEscapingSlashes])
                    setup=String(decoding:data,as:UTF8.self)
                default: throw AppIssue("Unknown connector.")
                }
                NSPasteboard.general.clearContents()
                guard NSPasteboard.general.setString(setup,forType:.string) else {throw AppIssue("The configuration could not be copied.")}
                reply(id,true,true)
            case "openCodex":
                guard let thread=body["thread"] as? String, UUID(uuidString:thread) != nil,
                      let url=URL(string:"codex://threads/"+thread), NSWorkspace.shared.open(url) else {
                    throw AppIssue("macOS could not open this local conversation in Codex.")
                }
                reply(id,true,true)
            case "paste": reply(id,true,NSPasteboard.general.string(forType:.string) ?? "")
            case "copy":
                guard let text=body["text"] as? String, !text.isEmpty, text.utf8.count <= 2_000_000 else {throw AppIssue("There is nothing to copy.")}
                NSPasteboard.general.clearContents()
                guard NSPasteboard.general.setString(text,forType:.string) else {throw AppIssue("The text could not be copied.")}
                reply(id,true,true)
            case "openAgentApp":
                // Bring forward the app the session runs in. Opening it through Launch Services works
                // even though Shishi itself is not the active app.
                let wanted=body["app"] as? String ?? ""
                let fallbacks=["com.apple.Terminal","com.googlecode.iterm2","com.mitchellh.ghostty","dev.warp.Warp-Stable",
                               "com.microsoft.VSCode","com.todesktop.230313mzl4w4u92","dev.zed.Zed","com.anthropic.claudefordesktop"]
                let preferred=AgentBoard.validBundle(wanted) ? [wanted] : []
                let running=fallbacks.filter {!NSRunningApplication.runningApplications(withBundleIdentifier:$0).isEmpty}
                guard let bundle=(preferred+running).first,
                      let url=NSWorkspace.shared.urlForApplication(withBundleIdentifier:bundle) else {
                    throw AppIssue("Shishi could not tell which app this session runs in. Switch to it yourself.")
                }
                // The exact tab, pane or folder when the hook recorded it; otherwise the app itself.
                let place=SessionFocus.Place(body["terminal"],cwd:body["cwd"])
                let found=SessionFocus.focus(bundle:bundle,place:place,app:url)
                reply(id,true,["app":FileManager.default.displayName(atPath:url.path).replacingOccurrences(of:".app",with:""),"found":found])
            case "dismissAgent":
                guard let key=body["key"] as? String else {throw AppIssue("The agent ID is missing.")}
                inboxQueue.async {
                    self.agentBoard.dismiss(key)
                    self.scanAgents(force:true)
                    DispatchQueue.main.async {self.reply(id,true,true)}
                }
            case "appearance":
                if let choice=body["value"] as? String, Host.appearances.contains(choice) {
                    UserDefaults.standard.set(choice,forKey:"ShiShiAppearance")
                    applyAppearance(choice)
                }
                reply(id,true,UserDefaults.standard.string(forKey:"ShiShiAppearance") ?? "system")
            case "menuBar":
                if let choice=body["value"] as? Bool {menuBar.enabled=choice}
                reply(id,true,menuBar.enabled)
            case "claudeCode":
                providers.claudeCode(body["action"] as? String ?? "status",approvals:body["approvals"] as? Bool == true) { [weak self] result in
                    switch result {
                    case .success(let state):self?.reply(id,true,state)
                    case .failure(let error):self?.reply(id,false,error.localizedDescription)
                    }
                }
            case "notion":
                providers.notion(body,window:window) { [weak self] result in
                    switch result {
                    case .success(let state):self?.reply(id,true,state)
                    case .failure(let error):self?.reply(id,false,error.localizedDescription)
                    }
                }
            case "openNotion":
                let page=(body["page"] as? String ?? "").replacingOccurrences(of:"-",with:"").lowercased()
                guard page.count==32, page.allSatisfy({$0.isASCII && $0.isHexDigit}),
                      let url=URL(string:"https://www.notion.so/"+page), NSWorkspace.shared.open(url) else {
                    throw AppIssue("This Notion page could not be opened.")
                }
                reply(id,true,true)
            case "latestSize": reply(id,true,true)
            case "cardSize":
                if let height=body["height"] as? Double, height.isFinite {card.setContentHeight(CGFloat(height))}
                reply(id,true,true)
            case "settings":
                if let on=body["hotkeys"] as? Bool {
                    UserDefaults.standard.set(on,forKey:"ShiShiHotkeys")
                    takenShortcuts=hotkeys.setEnabled(on)
                }
                if let on=body["usage"] as? Bool {UserDefaults.standard.set(on,forKey:"ShiShiShowUsage")}
                if let on=body["keepAwake"] as? Bool {
                    UserDefaults.standard.set(on,forKey:"ShiShiKeepAwake")
                    keepAwake.update(working:on && agentsWorking)
                }
                reply(id,true,settingsState())
            case "reminders","calendarEvents":
                let handle:EventKitBridge.Reply = { [weak self] result in
                    switch result {
                    case .success(let value):self?.reply(id,true,value)
                    case .failure(let error):self?.reply(id,false,error.localizedDescription)
                    }
                }
                if op=="reminders" {eventKit.reminders(body,reply:handle)} else {eventKit.events(body,reply:handle)}
            case "checkUpdate":
                // On by default and can be turned off. At most once a day; "force" is the Check Now button.
                let defaults=UserDefaults.standard
                if let on=body["enabled"] as? Bool {defaults.set(on,forKey:"ShiShiCheckUpdates")}
                let enabled=defaults.object(forKey:"ShiShiCheckUpdates") as? Bool ?? true
                let current=Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
                let last=defaults.double(forKey:"ShiShiUpdateCheckedAt")
                guard enabled, body["force"] as? Bool == true || Date().timeIntervalSince1970-last > 86400 else {
                    reply(id,true,["enabled":enabled,"current":current,"skipped":true]);break
                }
                Updates.check(current:current) { [weak self] result in
                    switch result {
                    case .success(var value):
                        defaults.set(Date().timeIntervalSince1970,forKey:"ShiShiUpdateCheckedAt")
                        value["enabled"]=enabled
                        self?.reply(id,true,value)
                    case .failure(let error):self?.reply(id,false,error.localizedDescription)
                    }
                }
            case "openRelease":
                guard let link=body["url"] as? String, link.hasPrefix("https://github.com/shen25308/small-tool/releases"),
                      link.count<300, let url=URL(string:link) else {throw AppIssue("That is not a Shishi release page.")}
                NSWorkspace.shared.open(url)
                reply(id,true,true)
            case "chooseFolder":
                AgentLaunch.chooseFolder { [weak self] path in self?.reply(id,true,path ?? "") }
            case "startAgent":
                let used=try AgentLaunch.start(agent:body["agent"] as? String ?? "",folder:body["folder"] as? String ?? "",
                                               prompt:body["prompt"] as? String ?? "",task:body["task"] as? String ?? "",
                                               terminal:body["terminal"] as? String ?? "Terminal",support:file.deletingLastPathComponent())
                reply(id,true,used)
            case "openIssue":
                // Only an issue page on github.com, nothing else.
                guard let link=body["url"] as? String, link.count<300,
                      link.range(of:#"^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}/issues/[0-9]{1,9}$"#,options:.regularExpression) != nil,
                      let url=URL(string:link) else {throw AppIssue("That is not a GitHub issue link.")}
                NSWorkspace.shared.open(url)
                reply(id,true,true)
            case "githubIssues":
                providers.githubIssues(body) { [weak self] result in
                    switch result {
                    case .success(let value):self?.reply(id,true,value)
                    case .failure(let error):self?.reply(id,false,error.localizedDescription)
                    }
                }
            case "usage":
                providers.usage { [weak self] result in
                    switch result {
                    case .success(let report):self?.reply(id,true,report)
                    case .failure(let error):self?.reply(id,false,error.localizedDescription)
                    }
                }
            case "alerts":
                alerts.update(body)
                reply(id,true,alerts.wire)
            case "testAlert":
                alerts.test()
                reply(id,true,true)
            case "answerApproval":
                guard let request=body["request"] as? String, let behavior=body["behavior"] as? String else {throw AppIssue("The request is missing.")}
                let board=approvals
                inboxQueue.async {
                    let answered=board.answer(request,behavior:behavior)
                    self.scanApprovals()
                    DispatchQueue.main.async {
                        if answered {self.reply(id,true,true)}
                        else {self.reply(id,false,"Claude Code is no longer waiting for this answer. Check the terminal.")}
                    }
                }
            case "approvalWait":
                if let seconds=body["value"] as? Int {approvals.wait=seconds}
                reply(id,true,approvals.wait)
            case "hookLog":
                // The last hook deliveries, newest first: event names and outcomes only, never content.
                let log=file.deletingLastPathComponent().appendingPathComponent("HookLog.jsonl")
                let lines=((try? String(contentsOf:log,encoding:.utf8)) ?? "").split(separator:"\n").suffix(100)
                let rows=lines.reversed().compactMap { (try? JSONSerialization.jsonObject(with:Data($0.utf8))) as? [String:Any] }
                    .map { row in ["time":row["time"] as? Double ?? 0,"source":String((row["source"] as? String ?? "").prefix(40)),
                                   "event":String((row["event"] as? String ?? "").prefix(40)),"session":String((row["session"] as? String ?? "").prefix(8)),
                                   "outcome":String((row["outcome"] as? String ?? "").prefix(160))] as [String:Any] }
                reply(id,true,rows)
            case "cardPrefs":
                // Window behaviour of the card is a set of explicit choices.
                if let snap=body["snap"] as? Bool {card.snapsToCorners=snap}
                if let spaces=body["allSpaces"] as? Bool {card.allSpaces=spaces}
                if let onTop=body["pinned"] as? Bool, onTop != pinned {togglePinned()}
                if body["fit"] as? Bool == true {card.fitHeightToContent()}
                reply(id,true,["snap":card.snapsToCorners,"allSpaces":card.allSpaces,"pinned":pinned,"userSized":card.userSized])
            case "pin":
                if let value=body["value"] as? Bool, value != pinned {togglePinned()}
                reply(id,true,pinned)
            case "nativeMenu":
                // A system menu can extend past the small card, unlike anything drawn inside the page.
                guard let items=body["items"] as? [[String:Any]] else {throw AppIssue("The menu is empty.")}
                let menu=NSMenu()
                menu.autoenablesItems=false
                let choice=MenuChoice()
                for item in items.prefix(40) {
                    if item["separator"] as? Bool == true {menu.addItem(.separator());continue}
                    let entry=NSMenuItem(title:String((item["title"] as? String ?? "").prefix(80)),action:#selector(MenuChoice.pick(_:)),keyEquivalent:"")
                    entry.target=choice
                    entry.representedObject=item["id"] as? String ?? ""
                    entry.state=item["checked"] as? Bool == true ? .on : .off
                    entry.isEnabled=item["enabled"] as? Bool ?? true
                    menu.addItem(entry)
                }
                menu.popUp(positioning:nil,at:NSEvent.mouseLocation,in:nil)
                reply(id,true,choice.chosen)
            case "compact": setCompact(body["value"] as? Bool == true);reply(id,true,true)
            case "extract":
                guard hasModel, let model=modelURL else {throw AppIssue("This light download leaves out the offline model that finds tasks in messages. Download it from Connections, or use the full version.")}
                guard !processing else{throw AppIssue("Shishi is still extracting tasks from the previous message. Try again in a moment.")}
                guard let text=body["text"] as? String else{throw AppIssue("Enter a message first.")}
                processing=true
                let resources=self.resources
                let runtime=inference
                DispatchQueue.global(qos:.userInitiated).async {
                    let result=Result{try Engine.extract(text,resources:resources,model:model,runtime:runtime)}
                    DispatchQueue.main.async {
                        self.processing=false
                        switch result {
                        case .success(let rows): self.reply(id,true,rows.map{["title":$0.title,"quote":$0.quote,"tag":$0.tag]})
                        case .failure(let error):self.reply(id,false,error.localizedDescription)
                        }
                    }
                }
            default: throw AppIssue("Unsupported action.")
            }
        } catch { reply(id,false,error.localizedDescription) }
    }
}
// `ShiShi --check-data` is read-only: it loads the saved workspace, Codex inbox and result receipts through the
// same decoders the app uses, prints what it found as JSON, and exits. It never writes to the data files.
if CommandLine.arguments.contains("--check-data") {
    let support=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("ShiShiDesk")
    var report:[String:Any]=["support":support.path,"version":Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
                             "commit":Bundle.main.infoDictionary?["ShishiSourceCommit"] as? String ?? "unknown"]
    var healthy=true
    let workspaceFile=support.appendingPathComponent("Workspace.json")
    if let bytes=try? Data(contentsOf:workspaceFile) {
        do {
            let workspace=try JSONDecoder().decode(Workspace.self,from:bytes)
            try workspace.validate()
            report["workspace"]=["lists":workspace.projects.count,"tasks":workspace.tasks.count,
                                 "open":workspace.tasks.filter{!$0.done}.count,"ids":workspace.tasks.map(\.id)] as [String:Any]
        } catch {healthy=false;report["workspace"]=["error":String(describing:error)] as [String:Any]}
    } else {report["workspace"]="none"}
    if FileManager.default.fileExists(atPath:support.appendingPathComponent("CodexInbox.json").path) {
        do {
            let notices=try CodexInbox(root:FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex"),
                                       store:support.appendingPathComponent("CodexInbox.json")).storedNotices()
            report["codex"]=["notices":notices.count,"unread":notices.filter{!$0.read}.count,"ids":notices.map(\.id)] as [String:Any]
        } catch {healthy=false;report["codex"]=["error":String(describing:error)] as [String:Any]}
    } else {report["codex"]="none"}
    if FileManager.default.fileExists(atPath:support.appendingPathComponent("Incoming").path) {
        do {
            let notices=try ConnectorInbox(directory:support.appendingPathComponent("Incoming",isDirectory:true)).scan().notices
            report["results"]=["notices":notices.count,"unread":notices.filter{!$0.read}.count,
                               "archived":notices.filter(\.archived).count,"ids":notices.map(\.id)] as [String:Any]
        } catch {healthy=false;report["results"]=["error":String(describing:error)] as [String:Any]}
    } else {report["results"]="none"}
    report["healthy"]=healthy
    let out=(try? JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys])) ?? Data()
    print(String(decoding:out,as:UTF8.self))
    exit(healthy ? 0 : 1)
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let host=Host()
app.delegate=host
app.run()
