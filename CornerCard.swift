import AppKit
import QuartzCore

/// A borderless panel that can take keyboard focus without activating Shishi, so typing into the
/// card never pulls you out of your editor.
final class CardPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// The small card that lives in a corner of the screen, like a desktop widget.
/// It snaps to the nearest corner after a drag and grows or shrinks to fit what it shows.
final class CornerCard: NSObject {
    enum Corner: String { case topLeft, topRight, bottomLeft, bottomRight }

    let panel: CardPanel
    private let backdrop = NSVisualEffectView()
    private(set) var corner: Corner
    private var contentHeight: CGFloat = 230
    private let width: CGFloat = 340
    private let margin: CGFloat = 14
    private let radius: CGFloat = 22
    private var dragMonitor: Any?

    override init() {
        corner = Corner(rawValue: UserDefaults.standard.string(forKey: "ShiShiCardCorner") ?? "") ?? .topRight
        panel = CardPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 230),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.title = "Shishi"
        backdrop.material = .popover
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active
        backdrop.maskImage = Self.roundedMask(radius: radius)
        panel.contentView = backdrop
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    /// A stretchable rounded rectangle. Masking the material this way keeps the corners smooth over any wallpaper.
    private static func roundedMask(radius: CGFloat) -> NSImage {
        let edge = radius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }

    func attach(_ view: NSView) {
        view.removeFromSuperview()
        view.frame = backdrop.bounds
        view.autoresizingMask = [.width, .height]
        view.wantsLayer = true
        view.layer?.cornerRadius = radius
        view.layer?.masksToBounds = true
        backdrop.addSubview(view)
    }

    func show(pinned: Bool) {
        setPinned(pinned)
        place(animated: false)
        panel.orderFrontRegardless()
    }

    func setPinned(_ pinned: Bool) {
        panel.level = pinned ? .floating : .normal
    }

    /// The page reports the height its content needs. The card keeps its corner while it resizes.
    func setContentHeight(_ height: CGFloat) {
        let next = max(120, min(height.rounded(.up), 760))
        guard abs(next - contentHeight) >= 1 else { return }
        contentHeight = next
        if panel.isVisible { place(animated: true) }
    }

    private func place(animated: Bool, on target: NSScreen? = nil) {
        guard let screen = target ?? panel.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let w = min(width, area.width - margin * 2), h = min(contentHeight, area.height - margin * 2)
        let right = corner == .topRight || corner == .bottomRight
        let top = corner == .topLeft || corner == .topRight
        let rect = NSRect(x: right ? area.maxX - w - margin : area.minX + margin,
                          y: top ? area.maxY - h - margin : area.minY + margin, width: w, height: h)
        if animated && panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.34
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1.0)
                panel.animator().setFrame(rect, display: true)
            } completionHandler: { [weak self] in self?.panel.invalidateShadow() }
        } else {
            panel.setFrame(rect, display: true)
            panel.invalidateShadow()
        }
    }

    /// Called when the page sees a mouse-down on the card's background. The card follows the
    /// pointer until the button is released, then glides into the nearest corner.
    func beginDrag() {
        guard dragMonitor == nil, NSEvent.pressedMouseButtons & 1 == 1 else { return }
        let start = NSEvent.mouseLocation, origin = panel.frame.origin
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] event in
            guard let self else { return event }
            if event.type == .leftMouseUp || NSEvent.pressedMouseButtons & 1 == 0 {
                self.endDrag()
            } else {
                let now = NSEvent.mouseLocation
                self.panel.setFrameOrigin(NSPoint(x: origin.x + now.x - start.x, y: origin.y + now.y - start.y))
            }
            return event
        }
    }

    private func endDrag() {
        if let monitor = dragMonitor { NSEvent.removeMonitor(monitor) }
        dragMonitor = nil
        let frame = panel.frame
        let center = NSPoint(x: frame.midX, y: frame.midY)
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(center) }) ?? panel.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let right = center.x >= area.midX, top = center.y >= area.midY
        corner = top ? (right ? .topRight : .topLeft) : (right ? .bottomRight : .bottomLeft)
        UserDefaults.standard.set(corner.rawValue, forKey: "ShiShiCardCorner")
        place(animated: true, on: screen)
    }

    @objc private func screensChanged() {
        if panel.isVisible { place(animated: false) }
    }
}

/// Receives the choice from a native context menu that the page asked for.
final class MenuChoice: NSObject {
    var chosen = ""
    @objc func pick(_ sender: NSMenuItem) { chosen = sender.representedObject as? String ?? "" }
}
