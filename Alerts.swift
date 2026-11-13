import AppKit
import UserNotifications

/// Optional alerts. Shishi stays silent by default; each kind of alert is a separate choice.
/// - "Needs you": a sound and/or banner when an agent starts waiting for you, and once more if it is still
///   waiting after the chosen number of minutes.
/// - Due tasks: a sound and/or banner when a task with a deadline time comes due.
/// Quiet hours silence both. Results still go to the inbox as always.
final class Alerts {
    private let defaults = UserDefaults.standard
    private var waitingSince: [String: Date] = [:]
    private var reminded: Set<String> = []
    private var bannersAllowed: Bool?

    struct Settings {
        var needsYou: Bool, due: Bool, sound: Bool, banner: Bool
        var quietFrom: String, quietTo: String, remindAfter: Int
    }

    static let reminderChoices = [0, 2, 5, 10]

    var settings: Settings {
        get {
            Settings(needsYou: defaults.bool(forKey: "ShiShiAlertNeedsYou"), due: defaults.bool(forKey: "ShiShiAlertDue"),
                     sound: defaults.object(forKey: "ShiShiAlertSound") as? Bool ?? true, banner: defaults.bool(forKey: "ShiShiAlertBanner"),
                     quietFrom: defaults.string(forKey: "ShiShiQuietFrom") ?? "", quietTo: defaults.string(forKey: "ShiShiQuietTo") ?? "",
                     remindAfter: defaults.object(forKey: "ShiShiRemindAfter") as? Int ?? 5)
        }
        set {
            defaults.set(newValue.needsYou, forKey: "ShiShiAlertNeedsYou")
            defaults.set(newValue.due, forKey: "ShiShiAlertDue")
            defaults.set(newValue.sound, forKey: "ShiShiAlertSound")
            defaults.set(newValue.banner, forKey: "ShiShiAlertBanner")
            defaults.set(Self.validTime(newValue.quietFrom) ? newValue.quietFrom : "", forKey: "ShiShiQuietFrom")
            defaults.set(Self.validTime(newValue.quietTo) ? newValue.quietTo : "", forKey: "ShiShiQuietTo")
            defaults.set(Self.reminderChoices.contains(newValue.remindAfter) ? newValue.remindAfter : 5, forKey: "ShiShiRemindAfter")
            if newValue.banner { requestBanners() }
        }
    }

    var wire: [String: Any] {
        let s = settings
        return ["needsYou": s.needsYou, "due": s.due, "sound": s.sound, "banner": s.banner, "quietFrom": s.quietFrom,
                "quietTo": s.quietTo, "remindAfter": s.remindAfter, "bannersAllowed": bannersAllowed as Any, "quietNow": quiet()]
    }

    func update(_ body: [String: Any]) {
        var s = settings
        if let v = body["needsYou"] as? Bool { s.needsYou = v }
        if let v = body["due"] as? Bool { s.due = v }
        if let v = body["sound"] as? Bool { s.sound = v }
        if let v = body["banner"] as? Bool { s.banner = v }
        if let v = body["quietFrom"] as? String { s.quietFrom = v }
        if let v = body["quietTo"] as? String { s.quietTo = v }
        if let v = body["remindAfter"] as? Int { s.remindAfter = v }
        settings = s
    }

    static func validTime(_ value: String) -> Bool {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return value.count == 5 && parts.count == 2 && (0..<24).contains(parts[0]) && (0..<60).contains(parts[1])
    }

    /// Quiet hours can cross midnight, for example 22:00 to 08:00.
    func quiet(at date: Date = Date()) -> Bool {
        let s = settings
        guard Self.validTime(s.quietFrom), Self.validTime(s.quietTo), s.quietFrom != s.quietTo else { return false }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        let now = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        return s.quietFrom < s.quietTo ? (now >= s.quietFrom && now < s.quietTo) : (now >= s.quietFrom || now < s.quietTo)
    }

    /// Called with the agents waiting for you after every scan. Alerts once when one starts waiting, and once more
    /// if it is still waiting after the chosen number of minutes.
    func agentsWaiting(_ waiting: [(key: String, title: String, detail: String)]) {
        let now = Date(), keys = Set(waiting.map(\.key))
        waitingSince = waitingSince.filter { keys.contains($0.key) }
        reminded = reminded.filter { keys.contains($0) }
        let s = settings
        for item in waiting {
            if waitingSince[item.key] == nil {
                waitingSince[item.key] = now
                if s.needsYou { alert(title: item.title + " needs you", body: item.detail, id: "agent-" + item.key) }
            } else if s.needsYou, s.remindAfter > 0, !reminded.contains(item.key),
                      let since = waitingSince[item.key], now.timeIntervalSince(since) >= Double(s.remindAfter * 60) {
                reminded.insert(item.key)
                alert(title: item.title + " is still waiting", body: item.detail, id: "agent-" + item.key)
            }
        }
    }

    func taskDue(title: String, summary: String, id: String) {
        guard settings.due else { return }
        alert(title: "Due: " + title, body: summary, id: "task-" + id)
    }

    func test() { alert(title: "Shishi", body: "This is how an alert sounds and looks.", id: "test", ignoreQuiet: true) }

    private func alert(title: String, body: String, id: String, ignoreQuiet: Bool = false) {
        guard ignoreQuiet || !quiet() else { return }
        let s = settings
        if s.sound { NSSound(named: "Glass")?.play() }
        guard s.banner else { return }
        let content = UNMutableNotificationContent()
        content.title = String(title.prefix(120))
        content.body = String(body.prefix(240))
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id + "-" + UUID().uuidString, content: content, trigger: nil))
    }

    private func requestBanners() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { [weak self] granted, _ in
            DispatchQueue.main.async { self?.bannersAllowed = granted }
        }
    }
}
