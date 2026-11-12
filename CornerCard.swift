import AppKit
import QuartzCore

/// A borderless panel that can take keyboard focus without activating Shishi, so typing into the
/// card never pulls you out of your editor.
final class CardPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// The strip along the top of the card. Dragging it moves the card; it never selects text or presses buttons.
final class CardGrip: NSView {
    var onEnd: (() -> Void)?
    private var start = NSPoint.zero, origin = NSPoint.zero
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        start = NSEvent.mouseLocation
        origin = window?.frame.origin ?? .zero
        NSCursor.closedHand.push()
    }
    override func mouseDragged(with event: NSEvent) {
        let now = NSEvent.mouseLocation
        window?.setFrameOrigin(NSPoint(x: origin.x + now.x - start.x, y: origin.y + now.y - start.y))
    }
    override func mouseUp(with event: NSEvent) {
        NSCursor.pop()
        onEnd?()
    }
}

/// The handle in the bottom-right corner. Dragging it sets the card's width and height.
final class CardResizeHandle: NSView {
    var onResize: ((NSRect) -> Void)?
    var onEnd: (() -> Void)?
    private var start = NSPoint.zero, startFrame = NSRect.zero
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        start = NSEvent.mouseLocation
        startFrame = window?.frame ?? .zero
    }
    override func mouseDragged(with event: NSEvent) {
        let now = NSEvent.mouseLocation
        let width = max(CornerCard.minimumSize.width, startFrame.width + now.x - start.x)
        let height = max(CornerCard.minimumSize.height, startFrame.height + start.y - now.y)
        // The top-left corner stays where it was while the handle moves.
        onResize?(NSRect(x: startFrame.minX, y: startFrame.maxY - height, width: width, height: height))
    }
    override func mouseUp(with event: NSEvent) { onEnd?() }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.tertiaryLabelColor.setStroke()
        let path = NSBezierPath()
        for inset in [3.0, 7.0] {
            path.move(to: NSPoint(x: bounds.maxX - 2, y: bounds.minY + inset))
            path.line(to: NSPoint(x: bounds.minX + inset, y: bounds.maxY - 2))
        }
        path.lineWidth = 1.2
        path.lineCapStyle = .round
        path.stroke()
    }
}

/// The small card that lives in a corner of the screen, like a desktop widget.
/// It snaps to the nearest corner after a drag and grows or shrinks to fit what it shows.
final class CornerCard: NSObject {
    enum Corner: String { case topLeft, topRight, bottomLeft, bottomRight }

    static let minimumSize = NSSize(width: 280, height: 150)
    let panel: CardPanel
    private let backdrop = NSVisualEffectView()
    private let grip = CardGrip()
    private let handle = CardResizeHandle()
    private(set) var corner: Corner
    private var contentHeight: CGFloat = 230
    private let defaultWidth: CGFloat = 340
    private let margin: CGFloat = 14
    private let radius: CGFloat = 22
    private let defaults = UserDefaults.standard
    /// A size the person chose with the handle. A missing height means the card follows its content.
    private var userWidth: CGFloat? { didSet { save("ShiShiCardWidth", userWidth) } }
    private var userHeight: CGFloat? { didSet { save("ShiShiCardHeight", userHeight) } }
    /// Where the card sits when corner snapping is off: its top-left point.
    private var freeTopLeft: NSPoint?
    var snapsToCorners: Bool { didSet { defaults.set(snapsToCorners, forKey: "ShiShiCardSnap"); if snapsToCorners { snapToNearestCorner() } else { rememberFreePosition() } } }
    var allSpaces: Bool { didSet { defaults.set(allSpaces, forKey: "ShiShiCardAllSpaces"); applySpaces() } }
    var userSized: Bool { userHeight != nil }

    override init() {
        corner = Corner(rawValue: UserDefaults.standard.string(forKey: "ShiShiCardCorner") ?? "") ?? .topRight
        snapsToCorners = UserDefaults.standard.object(forKey: "ShiShiCardSnap") as? Bool ?? true
        allSpaces = UserDefaults.standard.object(forKey: "ShiShiCardAllSpaces") as? Bool ?? false
        let width = UserDefaults.standard.double(forKey: "ShiShiCardWidth"), height = UserDefaults.standard.double(forKey: "ShiShiCardHeight")
        if let point = UserDefaults.standard.string(forKey: "ShiShiCardTopLeft") { freeTopLeft = NSPointFromString(point) }
        panel = CardPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 230),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        if width >= CornerCard.minimumSize.width { userWidth = width }
        if height >= CornerCard.minimumSize.height { userHeight = height }
        applySpaces()
        panel.title = "Shishi"
        backdrop.material = .popover
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active
        backdrop.maskImage = Self.roundedMask(radius: radius)
        panel.contentView = backdrop
        // The grip and the handle sit above the page, so their gestures never reach text or buttons.
        grip.frame = NSRect(x: 0, y: backdrop.bounds.height - 24, width: backdrop.bounds.width, height: 24)
        grip.autoresizingMask = [.width, .minYMargin]
        grip.setAccessibilityElement(true)
        grip.setAccessibilityRole(.handle)
        grip.setAccessibilityLabel("Move the card")
        grip.onEnd = { [weak self] in self?.dropped() }
        // Inside the rounded corner: a click on the transparent, masked-off corner would pass through to the
        // window behind, so the handle sits where the card is opaque.
        handle.frame = NSRect(x: backdrop.bounds.width - 24, y: 4, width: 20, height: 20)
        handle.autoresizingMask = [.minXMargin, .maxYMargin]
        handle.setAccessibilityElement(true)
        handle.setAccessibilityRole(.handle)
        handle.setAccessibilityLabel("Resize the card")
        handle.onResize = { [weak self] rect in self?.panel.setFrame(rect, display: true) }
        handle.onEnd = { [weak self] in self?.resized() }
        backdrop.addSubview(grip)
        backdrop.addSubview(handle)
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
        backdrop.addSubview(view, positioned: .below, relativeTo: grip)
    }

    func show(pinned: Bool) {
        setPinned(pinned)
        place(animated: false)
        panel.orderFrontRegardless()
    }

    func setPinned(_ pinned: Bool) {
        panel.level = pinned ? .floating : .normal
    }

    private func save(_ key: String, _ value: CGFloat?) {
        if let value { defaults.set(Double(value), forKey: key) } else { defaults.removeObject(forKey: key) }
    }

    private func applySpaces() {
        // By default the card belongs to one Space, like any window. All Spaces is an explicit choice.
        panel.collectionBehavior = allSpaces ? [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle] : [.managed, .ignoresCycle]
    }

    /// The page reports the height its content needs. The card keeps its place while it resizes,
    /// unless the person has set a height with the handle.
    func setContentHeight(_ height: CGFloat) {
        let next = max(120, min(height.rounded(.up), 760))
        guard abs(next - contentHeight) >= 1 else { return }
        contentHeight = next
        if panel.isVisible && userHeight == nil { place(animated: true) }
    }

    func fitHeightToContent() {
        userHeight = nil
        place(animated: true)
    }

    private func place(animated: Bool, on target: NSScreen? = nil) {
        guard let screen = target ?? panel.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let w = min(userWidth ?? defaultWidth, area.width - margin * 2), h = min(userHeight ?? contentHeight, area.height - margin * 2)
        var rect: NSRect
        if snapsToCorners || freeTopLeft == nil {
            let right = corner == .topRight || corner == .bottomRight
            let top = corner == .topLeft || corner == .topRight
            rect = NSRect(x: right ? area.maxX - w - margin : area.minX + margin,
                          y: top ? area.maxY - h - margin : area.minY + margin, width: w, height: h)
        } else {
            let point = freeTopLeft!
            rect = NSRect(x: point.x, y: point.y - h, width: w, height: h)
            // Keep a card dropped near an edge, or left on a disconnected display, on screen.
            rect.origin.x = max(area.minX, min(rect.minX, area.maxX - w))
            rect.origin.y = max(area.minY, min(rect.minY, area.maxY - h))
        }
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

    /// After a drag with the grip: snap to the nearest corner, or stay exactly where it was dropped.
    private func dropped() {
        if snapsToCorners { snapToNearestCorner() } else { rememberFreePosition() }
    }

    private func screenUnderCard() -> NSScreen? {
        let frame = panel.frame
        let center = NSPoint(x: frame.midX, y: frame.midY)
        return NSScreen.screens.first(where: { $0.frame.contains(center) }) ?? panel.screen ?? NSScreen.main
    }

    private func snapToNearestCorner() {
        guard let screen = screenUnderCard() else { return }
        let frame = panel.frame, area = screen.visibleFrame
        let right = frame.midX >= area.midX, top = frame.midY >= area.midY
        corner = top ? (right ? .topRight : .topLeft) : (right ? .bottomRight : .bottomLeft)
        defaults.set(corner.rawValue, forKey: "ShiShiCardCorner")
        place(animated: true, on: screen)
    }

    private func rememberFreePosition() {
        freeTopLeft = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        defaults.set(NSStringFromPoint(freeTopLeft!), forKey: "ShiShiCardTopLeft")
        place(animated: false, on: screenUnderCard())
    }

    private func resized() {
        userWidth = panel.frame.width.rounded()
        userHeight = panel.frame.height.rounded()
        if snapsToCorners { place(animated: true, on: screenUnderCard()) } else { rememberFreePosition() }
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
