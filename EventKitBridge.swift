import AppKit
import EventKit
import Foundation

/// Apple Reminders and Calendar through EventKit. Both are opt-in: macOS asks for access the first time the
/// person turns a feature on. Reminders: lists, pull and push for a two-way sync of one list. Calendar: events in a
/// date range, read only. Dates use the same shape as the Notion sync: "2026-11-20" or an ISO time with offset.
final class EventKitBridge {
    private let store = EKEventStore()
    typealias Reply = (Result<Any, Error>) -> Void

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter
    }()

    private func access(_ type: EKEntityType, _ done: @escaping (Bool) -> Void) {
        let status = EKEventStore.authorizationStatus(for: type)
        if status == .fullAccess { done(true); return }
        if status == .denied || status == .restricted { done(false); return }
        let finish: (Bool, Error?) -> Void = { granted, _ in DispatchQueue.main.async { done(granted) } }
        if type == .reminder { store.requestFullAccessToReminders(completion: finish) }
        else { store.requestFullAccessToEvents(completion: finish) }
    }

    private static func denied(_ type: EKEntityType) -> Error {
        AppIssue(type == .reminder
            ? "Shishi does not have access to Reminders. Allow it in System Settings → Privacy & Security → Reminders."
            : "Shishi does not have access to Calendars. Allow it in System Settings → Privacy & Security → Calendars.")
    }

    // MARK: Reminders

    func reminders(_ body: [String: Any], reply: @escaping Reply) {
        let action = body["action"] as? String ?? ""
        if action == "status" {
            reply(.success(["access": EKEventStore.authorizationStatus(for: .reminder) == .fullAccess])); return
        }
        access(.reminder) { [self] granted in
            guard granted else { reply(.failure(Self.denied(.reminder))); return }
            switch action {
            case "lists":
                let lists = store.calendars(for: .reminder).map { ["id": $0.calendarIdentifier, "title": $0.title] }
                reply(.success(["lists": lists]))
            case "pull":
                guard let calendar = calendar(body["list"]) else { reply(.failure(AppIssue("That Reminders list no longer exists. Choose another one."))); return }
                store.fetchReminders(matching: store.predicateForReminders(in: [calendar])) { items in
                    let pages = (items ?? []).map(Self.page)
                    DispatchQueue.main.async { reply(.success(["title": calendar.title, "pages": pages])) }
                }
            case "push":
                guard let calendar = calendar(body["list"]) else { reply(.failure(AppIssue("That Reminders list no longer exists. Choose another one."))); return }
                let changes = (body["changes"] as? [[String: Any]] ?? []).prefix(500)
                var results: [[String: Any]] = []
                for change in changes {
                    let task = change["task"] as? String ?? ""
                    let id = change["page"] as? String ?? ""
                    let fields = change["fields"] as? [String: Any] ?? [:]
                    let item: EKReminder
                    if id.isEmpty {
                        item = EKReminder(eventStore: store)
                        item.calendar = calendar
                    } else if let found = store.calendarItem(withIdentifier: id) as? EKReminder {
                        item = found
                    } else {
                        results.append(["task": task, "ok": false, "error": "A reminder was deleted in Reminders."]); continue
                    }
                    Self.apply(fields, to: item)
                    do {
                        try store.save(item, commit: false)
                        results.append(["task": task, "ok": true, "page": Self.page(item)])
                    } catch {
                        results.append(["task": task, "ok": false, "error": error.localizedDescription])
                    }
                }
                do { try store.commit() } catch { reply(.failure(error)); return }
                reply(.success(["results": results]))
            default:
                reply(.failure(AppIssue("Unsupported Reminders action.")))
            }
        }
    }

    private func calendar(_ id: Any?) -> EKCalendar? {
        guard let id = id as? String, !id.isEmpty else { return nil }
        return store.calendar(withIdentifier: id)
    }

    /// Reminders priority 1–4 is high, 5 medium, 6–9 low and 0 none. Shishi uses P0, P1 and P2.
    private static func priority(_ value: Int) -> String { value >= 1 && value <= 4 ? "P0" : value == 5 ? "P1" : "" }
    private static func ekPriority(_ value: String) -> Int { value == "P0" ? 1 : value == "P1" ? 5 : 0 }

    private static func page(_ item: EKReminder) -> [String: Any] {
        var due = ""
        if let parts = item.dueDateComponents, let year = parts.year, let month = parts.month, let day = parts.day {
            if parts.hour != nil, let date = Calendar.current.date(from: parts) { due = iso.string(from: date) }
            else { due = String(format: "%04d-%02d-%02d", year, month, day) }
        }
        return ["id": item.calendarItemIdentifier, "title": String((item.title ?? "").prefix(240)), "done": item.isCompleted,
                "due": due, "priority": priority(item.priority),
                "edited": item.lastModifiedDate.map { iso.string(from: $0) } ?? ""]
    }

    private static func apply(_ fields: [String: Any], to item: EKReminder) {
        if let title = fields["title"] as? String { item.title = String(title.prefix(240)) }
        if let done = fields["done"] as? Bool { item.isCompleted = done }
        if let priority = fields["priority"] as? String { item.priority = ekPriority(priority) }
        if let due = fields["due"] as? String {
            if due.isEmpty { item.dueDateComponents = nil }
            else if due.count == 10, let parts = dayParts(due) { item.dueDateComponents = parts }
            else if let date = iso.date(from: due) {
                item.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            }
        }
    }

    private static func dayParts(_ value: String) -> DateComponents? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return DateComponents(year: parts[0], month: parts[1], day: parts[2])
    }

    // MARK: Calendar

    /// Events from the start of `from` for `days` days, read only, from every calendar the person can see.
    func events(_ body: [String: Any], reply: @escaping Reply) {
        if body["action"] as? String == "status" {
            reply(.success(["access": EKEventStore.authorizationStatus(for: .event) == .fullAccess])); return
        }
        access(.event) { [self] granted in
            guard granted else { reply(.failure(Self.denied(.event))); return }
            guard let from = (body["from"] as? String).flatMap(Self.dayParts).flatMap({ Calendar.current.date(from: $0) }) else {
                reply(.failure(AppIssue("The date is missing."))); return
            }
            let days = max(1, min(body["days"] as? Int ?? 1, 14))
            let end = Calendar.current.date(byAdding: .day, value: days, to: from) ?? from
            let found = store.events(matching: store.predicateForEvents(withStart: from, end: end, calendars: nil))
            let rows: [[String: Any]] = found.prefix(200).map { event in
                ["title": String((event.title ?? "").prefix(200)), "start": Self.iso.string(from: event.startDate),
                 "end": Self.iso.string(from: event.endDate), "allDay": event.isAllDay,
                 "calendar": String(event.calendar.title.prefix(80)),
                 "color": event.calendar.color.map { color in
                     let rgb = color.usingColorSpace(.sRGB) ?? color
                     return String(format: "#%02x%02x%02x", Int(rgb.redComponent * 255), Int(rgb.greenComponent * 255), Int(rgb.blueComponent * 255))
                 } ?? ""]
            }
            reply(.success(["events": rows]))
        }
    }
}
