import Foundation

/// Looks up the latest published release on GitHub and says whether it is newer than this build.
/// It never downloads or installs anything; the person opens the release page if they want it.
/// One anonymous request, at most once a day unless asked, and it can be turned off.
enum Updates {
    static let endpoint = URL(string: "https://api.github.com/repos/shen25308/small-tool/releases/latest")!

    /// "1.7", "v1.10.2" → [1, 7] / [1, 10, 2]. Anything else is not a version.
    static func parts(_ value: String) -> [Int]? {
        let text = value.hasPrefix("v") ? String(value.dropFirst()) : value
        let numbers = text.split(separator: ".").map { Int($0) }
        guard (1...4).contains(numbers.count), numbers.allSatisfy({ $0 != nil && $0! >= 0 }) else { return nil }
        return numbers.compactMap { $0 }
    }

    static func isNewer(_ latest: String, than current: String) -> Bool {
        guard let a = parts(latest), let b = parts(current) else { return false }
        for index in 0..<max(a.count, b.count) {
            let x = index < a.count ? a[index] : 0, y = index < b.count ? b[index] : 0
            if x != y { return x > y }
        }
        return false
    }

    static func check(current: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        var request = URLRequest(url: endpoint, timeoutInterval: 15)
        request.setValue("Shishi-Desktop", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            let result = Result { () throws -> [String: Any] in
                if error != nil { throw AppIssue("Could not reach GitHub to check for updates.") }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 404 { return ["current": current, "latest": "", "newer": false] }
                guard status == 200, let data, data.count < 2_000_000,
                      let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let tag = object["tag_name"] as? String, parts(tag) != nil else {
                    throw AppIssue("GitHub did not return the latest release.")
                }
                let page = (object["html_url"] as? String).flatMap { link in
                    link.hasPrefix("https://github.com/shen25308/small-tool/releases/") && link.count < 300 ? link : nil
                } ?? "https://github.com/shen25308/small-tool/releases"
                return ["current": current, "latest": tag.hasPrefix("v") ? String(tag.dropFirst()) : tag,
                        "newer": isNewer(tag, than: current), "url": page, "checkedAt": Date().timeIntervalSince1970]
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }
}
