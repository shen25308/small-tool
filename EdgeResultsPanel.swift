import AppKit
import WebKit

/// The panel can be read above an editor. Receiving a result never orders a window or changes its size.
final class EdgeResultsPanel: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    let panel: NSPanel
    let web: WKWebView
    var onRead: ((String,String) -> Void)?
    var onWorkspace: (() -> Void)?
    var onHistory: (() -> Void)?
    var onVisibility: ((Bool) -> Void)?
    var showsMail = UserDefaults.standard.bool(forKey:"ShiShiDesktopMail")
    private var loaded = false
    private var byChannel: [String:[String:Any]] = [:]
    private enum Mode: String {
        case preview, details, original

        var contentSize: NSSize {
            switch self {
            case .preview: return NSSize(width:292,height:80)
            case .details: return NSSize(width:372,height:272)
            case .original: return NSSize(width:410,height:430)
            }
        }
    }
    private var mode = Mode.preview
    private var anchor = NSRect.zero
    private var placedFrame = NSRect.zero
    private let frameName = "ShiShiEdgeFrame"

    override init() {
        let config=WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        web=WKWebView(frame:.zero,configuration:config)
        panel=NSPanel(contentRect:NSRect(origin:.zero,size:Mode.preview.contentSize),
                      styleMask:[.titled,.closable,.resizable,.nonactivatingPanel],backing:.buffered,defer:false)
        super.init()
        config.userContentController.add(self,name:"edge")
        web.navigationDelegate=self
        web.underPageBackgroundColor = ShishiSurface.paper
        panel.delegate=self
        panel.title="Shishi · Desktop Results"
        panel.backgroundColor = ShishiSurface.paper
        panel.titlebarSeparatorStyle = .none
        panel.isReleasedWhenClosed=false
        panel.isFloatingPanel=true
        panel.level = .floating
        panel.becomesKeyOnlyIfNeeded=true
        panel.hidesOnDeactivate=false
        panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
        panel.contentMinSize=NSSize(width:260,height:76)
        panel.contentView=web
        let screen=NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1000,height:750)
        var rect=panel.frame
        rect.origin=NSPoint(x:screen.maxX-rect.width-14,y:screen.maxY-rect.height-14)
        if let stored=UserDefaults.standard.string(forKey:frameName) {
            let position=NSRectFromString(stored)
            if let display=NSScreen.screens.max(by:{ $0.frame.intersection(position).area < $1.frame.intersection(position).area }),
               display.visibleFrame.intersects(position) {
                // Older versions saved the entire large frame. Restore the corner, not its size.
                rect=Self.anchoredFrame(size:rect.size,at:position,screen:display.visibleFrame)
            }
        }
        panel.setFrame(rect,display:false)
        anchor=panel.frame
        placedFrame=panel.frame
        let ui=Bundle.main.resourceURL!.appendingPathComponent("UI")
        web.loadFileURL(ui.appendingPathComponent("result-panel.html"),allowingReadAccessTo:ui)
    }
    func setVisible(_ visible:Bool) {
        if visible {panel.orderFrontRegardless()} else {panel.orderOut(nil)}
        onVisibility?(visible)
    }
    // Run only when the user shows a window. Incoming results never move either surface.
    func avoidCovering(_ note:NSRect, on screen:NSRect) {
        let frame=panel.frame
        guard frame.intersects(note) else {return}
        let positions=[
            NSPoint(x:note.maxX-frame.width,y:note.minY-frame.height-8),
            NSPoint(x:note.minX-frame.width-8,y:note.maxY-frame.height),
            NSPoint(x:note.maxX+8,y:note.maxY-frame.height)
        ]
        for position in positions {
            let candidate=NSRect(origin:position,size:frame.size)
            if screen.contains(candidate) {
                panel.setFrameOrigin(position)
                anchor=panel.frame
                placedFrame=panel.frame
                return
            }
        }
    }
    func windowWillClose(_ notification:Notification){onVisibility?(false)}
    func windowDidMove(_ notification:Notification) {
        if panel.isVisible {UserDefaults.standard.set(NSStringFromRect(panel.frame),forKey:frameName)}
    }
    private static func anchoredFrame(size:NSSize,at anchor:NSRect,screen:NSRect)->NSRect {
        let width=min(size.width,screen.width),height=min(size.height,screen.height)
        let x=anchor.midX >= screen.midX ? anchor.maxX-width : anchor.minX
        return NSRect(x:max(screen.minX,min(x,screen.maxX-width)),
                      y:max(screen.minY,min(anchor.maxY-height,screen.maxY-height)),
                      width:width,height:height)
    }
    private func resize(to target:Mode) {
        guard target != mode else {return}
        // Keep the same anchor through details -> original -> preview. A user drag sets a new one.
        if panel.frame != placedFrame {anchor=panel.frame}
        let screen=panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? panel.frame
        let size=panel.frameRect(forContentRect:NSRect(origin:.zero,size:target.contentSize)).size
        panel.setFrame(Self.anchoredFrame(size:size,at:anchor,screen:screen),display:true)
        placedFrame=panel.frame
        mode=target
    }
    func discardPreview() {
        guard loaded else {return}
        web.evaluateJavaScript("window.forgetDisplayedResult()",completionHandler:nil)
    }
    func accept(channel:String,items:[[String:Any]]) {
        let suitable=items.first { row in
            let source=row["source"] as? String
            return showsMail || (source != "Gmail" && source != "Outlook")
        }
        if var latest=suitable {latest["channel"]=channel;byChannel[channel]=latest}
        else {byChannel.removeValue(forKey:channel)}
        send()
    }
    private func send() {
        guard loaded else {return}
        let items=byChannel.values.sorted {($0["time"] as? Double ?? 0)>($1["time"] as? Double ?? 0)}
        web.callAsyncJavaScript("window.setEdgeInbox(value);",arguments:["value":["items":items]],in:nil,in:.page,completionHandler:nil)
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.lastPathComponent=="result-panel.html",
              let body=message.body as? [String:Any],let op=body["op"] as? String else {return}
        switch op {
        case "ready":loaded=true;send()
        case "workspace":onWorkspace?()
        case "history":onHistory?()
        case "read":
            if let id=body["key"] as? String,let channel=body["channel"] as? String {onRead?(id,channel)}
        case "resize":
            if let name=body["mode"] as? String,let mode=Mode(rawValue:name) { resize(to:mode) }
        case "expanded":
            resize(to:body["value"] as? Bool == true ? .original : .preview)
        default:break
        }
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        let url=action.request.url
        decisionHandler(url?.isFileURL==true && url?.lastPathComponent=="result-panel.html" ? .allow : .cancel)
    }
}

private extension NSRect {
    var area: CGFloat { isNull ? 0 : width * height }
}
