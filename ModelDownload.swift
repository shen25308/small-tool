import Foundation
import CryptoKit

/// The light download leaves out the 1.1 GB offline model. This fetches the exact file the full download ships,
/// from a pinned revision, checks its SHA-256 before using it, and keeps it in Application Support (F18).
final class ModelDownload: NSObject, URLSessionDownloadDelegate {
    static let source = URL(string:"https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true")!
    static let sha256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
    static let expectedBytes: Int64 = 1_117_320_736

    /// Where a downloaded model lives. The bundled model, when present, always wins.
    static var installed: URL {
        FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
            .appendingPathComponent("ShiShiDesk/Models/assistant.gguf")
    }

    enum Event { case progress(received:Int64,total:Int64), verifying, finished(URL), failed(String) }
    private var session: URLSession?
    private var task: URLSessionDownloadTask?
    private var handler: ((Event) -> Void)?
    private var lastReport = Date.distantPast
    var running: Bool { task != nil }

    func start(_ handler: @escaping (Event) -> Void) {
        guard task == nil else { return }
        self.handler = handler
        let session = URLSession(configuration:.default,delegate:self,delegateQueue:nil)
        self.session = session
        let task = session.downloadTask(with:Self.source)
        self.task = task
        task.resume()
    }

    func cancel() {
        task?.cancel()
        finish(.failed("The download was cancelled."))
    }

    private func finish(_ event: Event) {
        task = nil
        session?.finishTasksAndInvalidate()
        session = nil
        let handler = self.handler
        self.handler = nil
        DispatchQueue.main.async { handler?(event) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard Date().timeIntervalSince(lastReport) > 0.25 else { return }
        lastReport = Date()
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : Self.expectedBytes
        let handler = self.handler
        DispatchQueue.main.async { handler?(.progress(received:totalBytesWritten,total:total)) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        if let response = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(response.statusCode) {
            finish(.failed("The model server answered with status \(response.statusCode). Nothing was installed."))
            return
        }
        let handler = self.handler
        DispatchQueue.main.async { handler?(.verifying) }
        do {
            guard try Self.digest(of:location) == Self.sha256 else {
                try? FileManager.default.removeItem(at:location)
                finish(.failed("The downloaded file did not match the expected checksum, so Shishi deleted it. Nothing was installed."))
                return
            }
            let target = Self.installed
            try FileManager.default.createDirectory(at:target.deletingLastPathComponent(),withIntermediateDirectories:true)
            try? FileManager.default.removeItem(at:target)
            try FileManager.default.moveItem(at:location,to:target)
            finish(.finished(target))
        } catch {
            finish(.failed("The model could not be installed: " + error.localizedDescription))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, self.task != nil else { return }
        finish(.failed("The download stopped: " + error.localizedDescription))
    }

    /// SHA-256 of a file, read in 8 MB pieces so a 1.1 GB model never sits in memory.
    static func digest(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom:url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount:8 << 20), !chunk.isEmpty { hash.update(data:chunk) }
        return hash.finalize().map { String(format:"%02x",$0) }.joined()
    }
}
