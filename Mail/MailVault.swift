import Foundation
import Security
import Darwin

/// This source is linked into ShiShi. No independently executable keychain helper is shipped.
struct MailKeychain {
    let service: String
    let isolatedKeychain: SecKeychain?

    init(service: String = "local.shishi.mail.oauth.v2", isolatedKeychain: SecKeychain? = nil) {
        self.service=service
        self.isolatedKeychain=isolatedKeychain
    }

    func perform(_ op: String, account: String, value: String?) -> [String:Any] {
        var query: [String:Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail
        ]
        if let isolatedKeychain { query[kSecMatchSearchList as String] = [isolatedKeychain] }
        var status:OSStatus = errSecParam
        switch op {
        case "get":
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var found:CFTypeRef?
            status=SecItemCopyMatching(query as CFDictionary,&found)
            if status==errSecSuccess, let data=found as? Data, let secret=String(data:data,encoding:.utf8) {
                return ["ok":true,"secret":secret]
            }
        case "put":
            guard let value, !value.isEmpty else {return ["ok":false,"error":"The authorization data is empty."]}
            let data=Data(value.utf8)
            status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
            if status==errSecItemNotFound {
                query.removeValue(forKey:kSecUseAuthenticationUI as String)
                query.removeValue(forKey:kSecMatchSearchList as String)
                if let isolatedKeychain { query[kSecUseKeychain as String]=isolatedKeychain }
                query[kSecValueData as String]=data
                query[kSecAttrLabel as String]="Shishi · Mail Authorization"
                status=SecItemAdd(query as CFDictionary,nil)
            }
        case "delete":
            status=SecItemDelete(query as CFDictionary)
            if status==errSecItemNotFound {status=errSecSuccess}
        default: break
        }
        if status==errSecSuccess {return ["ok":true]}
        return ["ok":false,"missing":status==errSecItemNotFound,"error":"Shishi could not access the saved mail authorization. Unlock your keychain or reconnect the account."]
    }
}

/// A new socketpair is created for each authorized Python invocation. Neither end has a filesystem
/// address. The child duplicates fd 2 and immediately redirects normal stderr to /dev/null.
final class MailVaultChannel {
    private let parent:FileHandle
    let child:FileHandle
    private let operation:String
    private let target:String?
    private let accounts:URL
    private let keychain:MailKeychain
    private var fetched=Set<String>()

    init(operation:String,target:String?,accounts:URL,keychain:MailKeychain = MailKeychain()) throws {
        var fds:[Int32]=[0,0]
        guard socketpair(AF_UNIX,SOCK_STREAM,0,&fds)==0 else {throw AppIssue("Shishi could not start the local mail authorization channel.")}
        for fd in fds {
            _ = fcntl(fd,F_SETFD,FD_CLOEXEC)
            var yes:Int32=1
            _ = setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,socklen_t(MemoryLayout<Int32>.size))
        }
        parent=FileHandle(fileDescriptor:fds[0],closeOnDealloc:true)
        child=FileHandle(fileDescriptor:fds[1],closeOnDealloc:true)
        self.operation=operation
        self.target=target
        self.accounts=accounts
        self.keychain=keychain
    }

    private func respond(_ data:Data) -> [String:Any] {
        guard let request=try? JSONSerialization.jsonObject(with:data) as? [String:Any],
              let op=request["op"] as? String,let id=request["account"] as? String,
              id.range(of:#"^[a-f0-9]{64}$"#,options:.regularExpression) != nil else {
            return ["ok":false,"error":"Invalid authorization request."]
        }
        switch (operation,op) {
        case ("connect","put"): break
        case ("sync","get"):
            guard FileManager.default.fileExists(atPath:accounts.appendingPathComponent(id+".json").path) else {
                return ["ok":false,"error":"This account no longer exists."]
            }
        case ("sync","put") where fetched.contains(id): break
        case ("disconnect","delete") where target==id: break
        default:return ["ok":false,"error":"This action cannot access this authorization."]
        }
        let result=keychain.perform(op,account:id,value:request["secret"] as? String)
        if op=="get",result["ok"] as? Bool==true {fetched.insert(id)}
        return result
    }

    func serve() {
        // Process.run() has dup'd this endpoint onto the child's stderr. Close our duplicate.
        try? child.close()
        defer {try? parent.close()}
        var pending=Data()
        do {
            var bytes=[UInt8](repeating:0,count:16384)
            while true {
                // Socket messages are much shorter than the buffer. POSIX read returns the
                // available prefix immediately, instead of waiting to fill a FileHandle read.
                let count=bytes.withUnsafeMutableBytes {Darwin.read(parent.fileDescriptor,$0.baseAddress,$0.count)}
                if count < 0 && errno == EINTR {continue}
                guard count > 0 else {break}
                pending.append(contentsOf:bytes.prefix(count))
                while let lf=pending.firstIndex(of:10) {
                    guard pending.distance(from:pending.startIndex,to:lf) <= 131072 else {return}
                    let answer=respond(pending[pending.startIndex..<lf])
                    pending.removeSubrange(...lf)
                    let encoded=try JSONSerialization.data(withJSONObject:answer)
                    try parent.write(contentsOf:encoded + Data([10]))
                }
                if pending.count>131072 {return}
            }
        } catch {
            // The child may have timed out, cancelled authorization, or exited normally.
        }
    }
}
