// Small helper for the native window checks: lists an app's windows, reports the screen, posts a drag.
import AppKit
import ApplicationServices
import CoreGraphics

func json(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "windows":
    let pid = Int32(args[2])!
    let info = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
    json(info.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }.map { window -> [String: Any] in
        let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
        return ["id": window[kCGWindowNumber as String] as? Int ?? 0, "name": window[kCGWindowName as String] as? String ?? "",
                "layer": window[kCGWindowLayer as String] as? Int ?? 0, "onscreen": window[kCGWindowIsOnscreen as String] as? Bool ?? false,
                "x": bounds["X"] ?? 0, "y": bounds["Y"] ?? 0, "w": bounds["Width"] ?? 0, "h": bounds["Height"] ?? 0]
    })
case "screen":
    // Window bounds above use a top-left origin; convert the visible frame to match.
    let screen = NSScreen.main!, full = screen.frame, visible = screen.visibleFrame
    json(["width": full.width, "height": full.height, "visibleX": visible.minX, "visibleTop": full.maxY - visible.maxY,
          "visibleWidth": visible.width, "visibleHeight": visible.height, "trusted": AXIsProcessTrusted()])
case "drag":
    let from = CGPoint(x: Double(args[2])!, y: Double(args[3])!), to = CGPoint(x: Double(args[4])!, y: Double(args[5])!)
    func post(_ type: CGEventType, _ point: CGPoint) {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(16_000)
    }
    post(.mouseMoved, from)
    post(.leftMouseDown, from)
    for step in 1...30 {
        let t = Double(step) / 30
        post(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
    }
    post(.leftMouseUp, to)
    json(["posted": true, "trusted": AXIsProcessTrusted()])
default:
    FileHandle.standardError.write(Data("usage: windows | screen | drag\n".utf8))
    exit(2)
}
