import Carbon.HIToolbox
import Foundation
import IOKit.pwr_mgt

/// System-wide shortcuts that work from any app: show or hide the card, and add a task.
/// Carbon hot keys need no Accessibility permission and only fire for these exact key combinations.
final class GlobalHotkeys {
    enum Action: UInt32 { case toggleCard = 1, quickAdd = 2 }
    static let labels: [Action: String] = [.toggleCard: "⌃⌥Space", .quickAdd: "⌃⌥N"]
    private static let keys: [Action: UInt32] = [.toggleCard: UInt32(kVK_Space), .quickAdd: UInt32(kVK_ANSI_N)]
    private var refs: [EventHotKeyRef] = []
    private var handlerRef: EventHandlerRef?
    private let onAction: (Action) -> Void

    init(onAction: @escaping (Action) -> Void) { self.onAction = onAction }

    var enabled: Bool { !refs.isEmpty }

    /// Returns the shortcuts that could not be registered because another app already uses them.
    @discardableResult
    func setEnabled(_ on: Bool) -> [String] {
        unregister()
        guard on else { return [] }
        if handlerRef == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let context = Unmanaged.passUnretained(self).toOpaque()
            InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
                guard let event, let context else { return OSStatus(eventNotHandledErr) }
                var id = EventHotKeyID()
                GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                  MemoryLayout<EventHotKeyID>.size, nil, &id)
                let me = Unmanaged<GlobalHotkeys>.fromOpaque(context).takeUnretainedValue()
                if let action = Action(rawValue: id.id) { DispatchQueue.main.async { me.onAction(action) } }
                return noErr
            }, 1, &spec, context, &handlerRef)
        }
        var taken: [String] = []
        for (action, key) in Self.keys.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: OSType(0x53_48_53_48), id: action.rawValue) // "SHSH"
            let status = RegisterEventHotKey(key, UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &ref)
            if status == noErr, let ref { refs.append(ref) } else { taken.append(Self.labels[action] ?? "") }
        }
        return taken
    }

    private func unregister() {
        refs.forEach { UnregisterEventHotKey($0) }
        refs = []
    }
}

/// Keeps the Mac from idle sleep while an agent is working, if the person turned this on.
/// It lets go as soon as no agent is working, including while one waits for an answer.
final class KeepAwake {
    private var assertion: IOPMAssertionID = 0
    private(set) var holding = false

    func update(working: Bool) {
        if working && !holding {
            holding = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep as CFString,
                                                  IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                                  "Shishi: a coding agent is working" as CFString, &assertion) == kIOReturnSuccess
        } else if !working && holding {
            IOPMAssertionRelease(assertion)
            holding = false
        }
    }
}
