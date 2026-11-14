import AppKit
import CryptoKit
import WebKit

struct Entry: Codable {
    let id, title, project, tag, priority, planned, source, quote: String
    let done: Bool
    let dueDate, dueTime: String?
    // Format 2. `planned` + `plannedTime` say when the user means to do the task; `dueDate` + `dueTime` stay the deadline.
    let plannedTime, completedAt: String?
    let deferCount: Int?
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
    static let currentVersion = 2
    func validate() throws {
        guard version == 1 || version == Workspace.currentVersion, !projects.isEmpty, Set(projects).count == projects.count,
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
    private var editorApp:NSRunningApplication?
    private var smallWorkspaceFrame: NSRect?
    private var expandedFrame: NSRect?
    private var compact = false
    private var placingWindow = false
    private var restoreTodayOnReturn = false
    private var pinned = UserDefaults.standard.object(forKey:"ShiShiTodayPinned") as? Bool ?? true
    private let modeButton = NSButton()
    private let pinButton = NSButton()
    private let titleStrip = WindowTitleStrip()
    private let caption = NSTextField(labelWithString:"My Notes")
    private var captionPosition: NSLayoutConstraint!
    private var startsWithToday: Bool {
        let args = CommandLine.arguments
        if args.contains("--edge-results") || args.contains("--open-inbox") || args.contains("--workspace") {return false}
        return args.contains("--compact-workspace") || (UserDefaults.standard.object(forKey:"ShiShiTodayMode") as? Bool ?? true)
    }
    private var ready = false
    private var pendingSource: String?
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
        pushInbox("external",warning:postDueReminders()) {
            let update=try externalInbox.scan()
            let send=force || update.changed || lastInboxErrors["external"] != nil
            if send {lastExternalRows=ConnectorInbox.wire(update.notices)}
            return (lastExternalRows,send)
        }
    }
    private func startInbox() {
        guard inboxTimer == nil else {return}
        _ = inbox
        _ = codexEnabled
        _ = externalInbox
        let timer=DispatchSource.makeTimerSource(queue:inboxQueue)
        timer.schedule(deadline:.now(),repeating:.seconds(10),leeway:.seconds(1))
        timer.setEventHandler { [weak self] in self?.scanInboxes() }
        inboxTimer=timer
        timer.resume()
    }
    private func showEdge(_ visible:Bool) {
        if visible && compact,let screen=window.screen?.visibleFrame {
            edge.avoidCovering(window.frame,on:screen)
        }
        edge.setVisible(visible)
    }
    private let file: URL
    private lazy var edge: EdgeResultsPanel = {
        let result = EdgeResultsPanel()
        result.onVisibility = { [weak self] shown in
            UserDefaults.standard.set(shown,forKey:"ShiShiShowsResults")
            self?.tell("setEdgeVisible",shown)
        }
        result.onHistory = { [weak self] in self?.openWorkspace(inbox:true,fromEdge:true) }
        result.onWorkspace = { [weak self] in self?.openWorkspace(inbox:false,fromEdge:true) }
        result.onRead = { [weak self] id, channel in self?.markNotice(id,channel:channel) }
        result.onOpen = { [weak self] id, channel, thread in self?.openSource(key:id,channel:channel,thread:thread) }
        result.onAddTask = { [weak self] title in self?.tell("addTaskFromResult",title) }
        return result
    }()
    private lazy var providers = ExternalProviders(resources:resources)
    private var storeUnreadable = false
    private var lastExtraction: [String:Any]?
    /// Format 1 gains three optional task fields in format 2. The original file is kept beside the new one,
    /// because earlier versions of Shishi refuse to open a format 2 file.
    private func upgradeWorkspace(_ bytes:Data) throws -> Data {
        let backup=file.deletingLastPathComponent().appendingPathComponent("Workspace.v1.backup.json")
        if !FileManager.default.fileExists(atPath:backup.path) {try bytes.write(to:backup,options:.atomic)}
        guard var object=try JSONSerialization.jsonObject(with:bytes) as? [String:Any] else {throw AppIssue("Invalid workspace data.")}
        object["version"]=Workspace.currentVersion
        let upgraded=try JSONSerialization.data(withJSONObject:object,options:[.sortedKeys])
        try upgraded.write(to:file,options:.atomic)
        return upgraded
    }
    private func openSource(key:String,channel:String,thread:String) {
        if UUID(uuidString:thread) != nil, let url=URL(string:"codex://threads/"+thread) {
            NSWorkspace.shared.open(url)
            return
        }
        guard channel=="external" else {return}
        inboxQueue.async {
            guard let row=self.lastExternalRows.first(where:{$0["id"] as? String == key}),
                  let link=row["link"] as? String, let source=row["source"] as? String,
                  let url=ConnectorInbox.safeLink(link,source:source) else {return}
            DispatchQueue.main.async {NSWorkspace.shared.open(url)}
        }
    }
    private func applyInboxChanges(_ changes:[[String:Any]],request:String) {
        let codex=inbox, external=externalInbox
        inboxQueue.async {
            do {
                for change in changes {
                    guard let key=change["id"] as? String else {continue}
                    let flags=NoticeFlags(read:change["read"] as? Bool,archived:change["archived"] as? Bool,accepted:change["accepted"] as? Bool)
                    if change["channel"] as? String=="external" {try external.setFlags(key,flags)} else {try codex.setFlags(key,flags)}
                }
                self.scanInboxes(force:true)
                DispatchQueue.main.async {self.reply(request,true,true)}
            } catch {
                self.scanInboxes(force:true)
                DispatchQueue.main.async {self.reply(request,false,error.localizedDescription)}
            }
        }
    }
    /// Only figures this Mac can read without a network request. Providers with no confirmed local source say why.
    private func quotaReport() -> [String:Any] {
        var local:[String:Any]=["id":"qwen","windows":[Any](),"status":"local",
                                "available":FileManager.default.fileExists(atPath:resources.appendingPathComponent("assistant.gguf").path)]
        if let run=lastExtraction {local["lastRun"]=run}
        func notReadable(_ id:String, _ status:String) -> [String:Any] {
            let row:[String:Any]=["id":id,"windows":[Any](),"status":status]
            return row
        }
        let providers:[[String:Any]]=[notReadable("codex","unconfirmed"),notReadable("claude","needsStatusLine"),notReadable("grok","usageOnly"),local]
        let report:[String:Any]=["providers":providers]
        return report
    }
    private let resources = Bundle.main.resourceURL!

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = support.appendingPathComponent("ShiShiDesk/Workspace.json")
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "host")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.underPageBackgroundColor = .windowBackgroundColor
        let style:NSWindow.StyleMask = [.titled,.closable,.miniaturizable,.resizable]
        let display = NSScreen.main?.visibleFrame.size ?? NSSize(width:760,height:800)
        let frame=NSRect(x:0,y:0,width:min(760,display.width),height:min(800,display.height))
        window = NSWindow(contentRect:NSWindow.contentRect(forFrameRect:frame,styleMask:style),styleMask:style,backing:.buffered,defer:false)
        window.title = "My Notes"
        window.backgroundColor = .windowBackgroundColor
        window.titlebarSeparatorStyle = .none
        window.minSize = NSSize(width: 635,height: 420)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = web
        addWindowControls()
        window.center()
        window.setFrameAutosaveName("ShiShiTallWorkspace")
        NSApplication.shared.servicesProvider = self
        makeMenu()
        let ui = resources.appendingPathComponent("UI",isDirectory:true)
        web.loadFileURL(ui.appendingPathComponent("index.html"),allowingReadAccessTo: ui)
        if CommandLine.arguments.contains("--edge-results") {
            showEdge(true)
        } else if !startsWithToday {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            if UserDefaults.standard.object(forKey:"ShiShiShowsResults") as? Bool ?? true {showEdge(true)}
        }
    }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {
        openWorkspace(inbox:false);return true
    }
    private func openWorkspace(inbox:Bool,fromEdge:Bool=false) {
        if fromEdge {
            restoreTodayOnReturn = restoreTodayOnReturn || (compact && window.isVisible)
            let front=NSWorkspace.shared.frontmostApplication
            if front?.processIdentifier != ProcessInfo.processInfo.processIdentifier {editorApp=front}
        }
        if compact {setCompact(false)}
        tell("setWorkspaceReturn",fromEdge)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        if inbox {tell("openInbox",fromEdge ? "edge" : "main")}
        else if fromEdge {tell("showWorkspaceHome",true)}
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.isFileURL, url.lastPathComponent=="index.html" { decisionHandler(.allow) }
        else { decisionHandler(.cancel) }
    }
    private func makeMenu() {
        let bar=NSMenu()
        let appItem=NSMenuItem()
        bar.addItem(appItem)
        let appMenu=NSMenu(title:"Shishi")
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
        window.level = compact && pinned ? .floating : .normal
        updateWindowControls()
    }
    private func tell(_ function: String, _ arg: Any) {
        if function=="setInbox", let state=arg as? [String:Any],let rows=state["items"] as? [[String:Any]],let channel=state["channel"] as? String {
            edge.accept(channel:channel,items:rows)
        }
        web.callAsyncJavaScript("window[fn](value);",arguments:["fn":function,"value":arg],in:nil,in:.page,completionHandler:nil)
    }
    @objc private func toggleCompact() { setCompact(!compact) }
    private func setCompact(_ enabled: Bool) {
        guard compact != enabled else { return }
        placingWindow = true
        defer {placingWindow = false}
        compact = enabled
        UserDefaults.standard.set(enabled,forKey:"ShiShiTodayMode")
        updateWindowControls()
        smallWorkspaceFrame=nil
        if enabled {
            expandedFrame=window.frame
            // Keep the expanded window's saved geometry independent from the floating view.
            window.setFrameAutosaveName("")
            window.minSize=NSSize(width:300,height:320)
            let screen=window.screen?.visibleFrame ?? window.frame
            let width=min(356,screen.width), height=min(484,screen.height)
            var rect=NSRect(x:screen.maxX-width-16,y:screen.maxY-height-16,width:width,height:height)
            if let saved=UserDefaults.standard.string(forKey:"ShiShiTodayFrame") {
                let frame=NSRectFromString(saved)
                if frame.width>=300,frame.height>=320,let display=NSScreen.screens.first(where:{$0.visibleFrame.contains(frame)}) {
                    rect=frame.intersection(display.visibleFrame)
                }
            }
            window.setFrame(rect,display:true)
            window.level = pinned ? .floating : .normal
            window.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]
            if edge.panel.isVisible {edge.avoidCovering(window.frame,on:screen)}
        } else {
            window.level = .normal
            window.collectionBehavior = []
            window.minSize = NSSize(width:635,height:420)
            if let frame=expandedFrame {window.setFrame(frame,display:true)}
            window.setFrameAutosaveName("ShiShiTallWorkspace")
        }
        tell("setCompact",enabled)
    }
    private func rememberTodayFrame() {
        if compact && !placingWindow && smallWorkspaceFrame == nil && window.isVisible {
            UserDefaults.standard.set(NSStringFromRect(window.frame),forKey:"ShiShiTodayFrame")
        }
    }
    func windowDidMove(_ notification:Notification) {rememberTodayFrame()}
    func windowDidEndLiveResize(_ notification:Notification) {rememberTodayFrame()}
    private func sizeLatestResult(expanded:Bool) {
        guard compact, let screen=window.screen?.visibleFrame else {return}
        let current=window.frame
        let size:NSSize
        if expanded {
            guard smallWorkspaceFrame==nil else {return}
            smallWorkspaceFrame=current
            size=NSSize(width:max(current.width,382),height:max(current.height,475))
        } else {
            guard let previous=smallWorkspaceFrame else {return}
            size=previous.size
            smallWorkspaceFrame=nil
        }
        let width=min(size.width,screen.width),height=min(size.height,screen.height)
        let left=current.midX >= screen.midX ? current.maxX-width : current.minX
        let x=max(screen.minX,min(left,screen.maxX-width))
        let y=max(screen.minY,min(current.maxY-height,screen.maxY-height))
        window.setFrame(NSRect(x:x,y:y,width:width,height:height),display:true)
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
                        var bytes=try Data(contentsOf:file)
                        let state=try JSONDecoder().decode(Workspace.self,from:bytes)
                        try state.validate()
                        if state.version < Workspace.currentVersion {bytes=try upgradeWorkspace(bytes)}
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
            case "ready":
                ready=true
                if startsWithToday {
                    setCompact(true)
                    window.orderFrontRegardless()
                    if UserDefaults.standard.bool(forKey:"ShiShiShowsResults") {showEdge(true)}
                }
                startInbox()
                providers.startPolling { [weak self] in
                    self?.inboxQueue.async { [weak self] in self?.scanInboxes(force:true) }
                }
                tell("setEdgeVisible",edge.panel.isVisible)
                if CommandLine.arguments.contains("--open-inbox") {
                    tell("openInbox",true)
                }
                reply(id,true,true)
                if let text=pendingSource{pendingSource=nil;receive(text)}
            case "locale":
                let info:[String:Any]=["languages":Locale.preferredLanguages,"timeZone":TimeZone.current.identifier]
                reply(id,true,info)
            case "prefs":
                // Interface preferences (sky palette, hidden sidebar, …). The web view keeps no storage of its own.
                var stored=UserDefaults.standard.dictionary(forKey:"ShiShiUIPrefs") ?? [:]
                if let changes=body["set"] as? [String:Any] {
                    for (key,value) in changes where key.count<=40 {
                        if value is NSNull {stored.removeValue(forKey:key)}
                        else if value is String || value is NSNumber {stored[key]=value}
                    }
                    UserDefaults.standard.set(stored,forKey:"ShiShiUIPrefs")
                }
                reply(id,true,stored)
            case "quota": reply(id,true,quotaReport())
            case "inboxState":
                guard let changes=body["changes"] as? [[String:Any]] else {throw AppIssue("The inbox change is missing.")}
                applyInboxChanges(changes,request:id)
            case "focus":
                edge.holding=body["value"] as? Bool == true
                reply(id,true,edge.holding)
            case "syncInboxes":
                inboxQueue.async {
                    self.scanInboxes(force:true)
                    DispatchQueue.main.async {self.reply(id,true,true)}
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
                        if body["action"] as? String=="disconnect",body["purge"] as? Bool==true {self.edge.discardPreview()}
                        self.reply(id,true,response)
                        if body["action"] as? String != "status" {
                            self.inboxQueue.async {self.scanInboxes(force:true)}
                        }
                    case .failure(let error):self.reply(id,false,error.localizedDescription)
                    }
                }
            case "edgeMailPreference":
                if let choice=body["value"] as? Bool {
                    edge.showsMail=choice
                    UserDefaults.standard.set(choice,forKey:"ShiShiDesktopMail")
                    edge.discardPreview()
                    inboxQueue.async {self.scanInboxes(force:true)}
                }
                reply(id,true,edge.showsMail)
            case "returnToEdge":
                if restoreTodayOnReturn {
                    setCompact(true)
                    window.orderFrontRegardless()
                } else {window.orderOut(nil)}
                restoreTodayOnReturn=false
                showEdge(true)
                if let editor=editorApp,!editor.isTerminated {editor.activate(options:[])} else {NSApp.deactivate()}
                editorApp=nil
                tell("setWorkspaceReturn",false)
                reply(id,true,true)
            case "edgeVisibility":
                showEdge(body["value"] as? Bool == true)
                reply(id,true,edge.panel.isVisible)
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
            case "latestSize":
                sizeLatestResult(expanded:body["expanded"] as? Bool == true)
                reply(id,true,true)
            case "compact": setCompact(body["value"] as? Bool == true);reply(id,true,true)
            case "extract":
                guard !processing else{throw AppIssue("Shishi is still extracting tasks from the previous message. Try again in a moment.")}
                guard let text=body["text"] as? String else{throw AppIssue("Enter a message first.")}
                processing=true
                let resources=self.resources
                let runtime=Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/Inference")
                let started=Date()
                DispatchQueue.global(qos:.userInitiated).async {
                    let result=Result{try Engine.extract(text,resources:resources,runtime:runtime)}
                    DispatchQueue.main.async {
                        self.processing=false
                        if case .success(let rows)=result {
                            self.lastExtraction=["seconds":Date().timeIntervalSince(started),"count":rows.count,"at":Date().timeIntervalSince1970]
                        }
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
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let host=Host()
app.delegate=host
app.run()
