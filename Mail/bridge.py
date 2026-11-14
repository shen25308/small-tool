#!/usr/bin/env python3
"""Desktop OAuth and metadata-only inbox synchronizer. A process returns one JSON object."""
import argparse
import base64
import contextlib
import datetime
import email.utils
import fcntl
import hashlib
import hmac
import http.server
import importlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import webbrowser

import mail_http

HERE = Path(__file__).resolve().parent
SUPPORT = Path.home() / "Library/Application Support/ShiShiDesk"
ACCOUNTS = SUPPORT / "MailAccounts"
INCOMING = SUPPORT / "Incoming"
class VaultNeedsReconnect(ValueError):
    pass


def private_vault_channel():
    if os.environ.pop("SHISHI_MAIL_PRIVATE_FD", None) != "2":
        return None
    # Keep the endpoint out of any browser or other process spawned by the OAuth flow.
    fd = os.dup(2)
    with open(os.devnull, "wb") as sink:
        os.dup2(sink.fileno(), 2)
    try:
        channel = socket.socket(fileno=fd)
    except OSError:
        os.close(fd)
        return None
    if channel.family != socket.AF_UNIX or channel.type != socket.SOCK_STREAM:
        channel.close()
        return None
    channel.settimeout(25)
    return channel


VAULT_CHANNEL = private_vault_channel()
PROVIDERS = {"gmail":"Gmail", "outlook":"Outlook"}


def atomic_save(path, value):
    path.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8",delete=False) as stream:
        try:
            json.dump(value,stream,ensure_ascii=False,allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(stream.name,path)
        finally:
            Path(stream.name).unlink(missing_ok=True)


@contextlib.contextmanager
def account_lock(key):
    if not re.fullmatch(r"[a-f0-9]{64}",key):
        raise ValueError("Invalid mail account ID.")
    ACCOUNTS.mkdir(parents=True,mode=0o700,exist_ok=True)
    fd = os.open(ACCOUNTS / (key+".lock"),os.O_CREAT|os.O_RDWR,0o600)
    with os.fdopen(fd,"a+") as stream:
        fcntl.flock(stream,fcntl.LOCK_EX)
        yield ACCOUNTS/(key+".json")


def vault(op,key,secret=None):
    data = {"op":op,"account":key}
    if secret is not None:
        data["secret"] = json.dumps(secret,separators=(",",":"))
    if VAULT_CHANNEL is None:
        raise ValueError("Open the mail connector in Shishi to authorize this account.")
    packet = json.dumps(data,ensure_ascii=False,separators=(",",":")).encode() + b"\n"
    if len(packet)>131072:
        raise ValueError("The authorization request is too large.")
    VAULT_CHANNEL.sendall(packet)
    with VAULT_CHANNEL.makefile("rb") as reader:
        line=reader.readline(131073)
    if not line.endswith(b"\n") or len(line)>131072:
        raise ValueError("The local authorization connection closed.")
    try:
        payload=json.loads(line)
    except (ValueError,TypeError):
        raise ValueError("Invalid response from the local authorization service.") from None
    if not payload.get("ok"):
        if payload.get("missing"):
            raise VaultNeedsReconnect("The saved authorization has expired or needs an update. Reconnect this account.")
        raise ValueError(payload.get("error","Local authorization failed."))
    return json.loads(payload["secret"]) if op=="get" else None


def settings(provider, client_id, provided):
    config_path = HERE/"provider-config.json"
    builtin = json.loads(config_path.read_text()).get(provider,{}) if config_path.is_file() else {}
    creds = provided or builtin
    if "installed" in creds:
        if provider!="gmail":
            raise ValueError("Enter the client ID of a desktop app registered with Microsoft.")
        creds=creds["installed"]
    elif "web" in creds:
        raise ValueError("Use a Google OAuth client JSON file created for a desktop app.")
    identifier = (client_id or creds.get("client_id","")).strip()
    secret = creds.get("client_secret","") if provider=="gmail" else ""
    if not isinstance(secret,str) or not re.fullmatch(r"[A-Za-z0-9._-]{6,255}",identifier):
        raise ValueError("Set up a desktop OAuth client for this mail provider first.")
    return identifier,secret


def authorize_code(module,provider,client_id):
    state=secrets.token_urlsafe(40)
    verifier=secrets.token_urlsafe(64)
    digest=hashlib.sha256(verifier.encode("ascii")).digest()
    challenge=base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    result={}
    class Callback(http.server.BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def do_GET(self):
            url=urllib.parse.urlsplit(self.path)
            query=urllib.parse.parse_qs(url.query)
            matched=(url.path=="/callback" and hmac.compare_digest(query.get("state",[""])[0].encode(),state.encode()))
            if matched:
                if query.get("error") or not query.get("code"):
                    result["error"]="Sign-in was canceled or the mail provider declined access."
                else:
                    result["code"]=query["code"][0]
            text="Shishi received the sign-in result. You can close this page." if matched else "Invalid authorization callback."
            payload=("<!doctype html><html lang='en'><meta charset='utf-8'><title>Shishi</title><p>"+text+"</p></html>").encode()
            self.send_response(200 if matched else 400)
            self.send_header("Content-Type","text/html; charset=utf-8")
            self.send_header("Cache-Control","no-store")
            self.send_header("Referrer-Policy","no-referrer")
            self.send_header("Content-Security-Policy","default-src 'none'")
            self.send_header("Content-Length",str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    class LocalServer(http.server.HTTPServer):
        def get_request(self):
            conn,addr=super().get_request()
            conn.settimeout(3)
            return conn,addr
    with LocalServer(("127.0.0.1",0),Callback) as server:
        host="localhost" if provider=="outlook" else "127.0.0.1"
        redirect=f"http://{host}:{server.server_port}/callback"
        target=module.authorization(client_id,redirect,challenge,state)
        if not webbrowser.open(target,new=2):
            raise ValueError("Could not open a browser. Set a default browser and try again.")
        until=time.monotonic()+300
        server.timeout=1
        while not result and time.monotonic()<until:
            server.handle_request()
    if "code" not in result:
        raise ValueError(result.get("error","Mail sign-in timed out. Reconnect this account."))
    return result["code"],redirect,verifier


def tokens(previous, reply):
    access=reply.get("access_token")
    refresh=reply.get("refresh_token") or previous.get("refresh_token")
    if not isinstance(access,str) or not access or not isinstance(refresh,str) or not refresh:
        raise ValueError("The provider did not grant offline access. Reconnect the account and allow the requested permissions.")
    seconds=max(0,int(reply.get("expires_in",3600)))
    return {**previous,"access_token":access,"refresh_token":refresh,"expires":time.time()+seconds}


def checked_sender(value):
    value=(value or "").strip()
    if not value:return ""
    address=email.utils.parseaddr(value)[1].casefold()
    if not re.fullmatch(r"[^<>@\s]+@[^<>@\s]+",address):
        raise ValueError("Enter the full email address of the sender.")
    return address


def get_account(path):
    if not path.exists():
        raise ValueError("This mail account is no longer connected.")
    return json.loads(path.read_text())


def public(account):
    fields = {field:account.get(field) for field in ("id","provider","email","sender","state","error","lastSync")}
    # Older versions stored localized status text. Keep user data and the persisted state intact.
    error = fields.get("error") or ""
    if mail_http.has_legacy_status(error):
        code = re.search(r"HTTP ([0-9]{3})", error)
        if code:
            fields["error"] = f"The mail service returned HTTP {code.group(1)}."
        elif fields["state"] == "cursor_expired":
            fields["error"] = "The saved sync position has expired. Reconnect this account."
        elif fields["state"] == "reconnect":
            fields["error"] = "Reconnect this mail account to resume delivery."
        else:
            fields["error"] = "Mail sync failed. Check your connection and try again."
    return fields


def status():
    items=[]
    for path in sorted(ACCOUNTS.glob("*.json")):
        try:
            items.append(public(json.loads(path.read_text())))
        except FileNotFoundError:  # A disconnect completed while listing this directory.
            pass
    return items


def public_configuration():
    path=HERE/"provider-config.json"
    defaults=json.loads(path.read_text()) if path.is_file() else {}
    return {name:bool(defaults.get(name,{}).get("client_id") or defaults.get(name,{}).get("installed",{}).get("client_id")) for name in PROVIDERS}


def purge_deliveries(account):
    # The sender ties each immutable envelope filename to source + account-scoped event ID.
    # Only retire intact deliveries owned by this account. Leave malformed and unrelated files alone.
    count=0
    source=PROVIDERS[account["provider"]]
    prefix=account["id"]+"/"
    for path in INCOMING.glob("*.json"):
        if path.is_symlink() or not re.fullmatch(r"[0-9a-f]{64}",path.stem):continue
        try:
            if path.stat().st_size>480*1024:continue
            row=json.loads(path.read_bytes())
        except (FileNotFoundError,ValueError,UnicodeError):continue
        event=row.get("eventID") if isinstance(row,dict) else None
        if not isinstance(event,str) or row.get("source")!=source or not event.startswith(prefix):continue
        if not re.fullmatch(r"[0-9a-f]{64}",event[len(prefix):]):continue
        expected=hashlib.sha256((source+"\0"+event).encode()).hexdigest()
        if expected!=path.stem:continue
        for receipt in (".read",".archived",".accepted"):
            path.with_suffix(receipt).unlink(missing_ok=True)
        path.unlink(missing_ok=True)
        count+=1
    return count


def connect(args, provided):
    module=importlib.import_module(args.provider)
    sender=checked_sender(args.sender)
    client_id,secret=settings(args.provider,args.client_id,provided)
    code,redirect,verifier=authorize_code(module,args.provider,client_id)
    initial=tokens({"client_id":client_id,"client_secret":secret},module.exchange(client_id,code,redirect,verifier,secret))
    address=module.identity(initial["access_token"]).strip()
    if not address or len(address)>320:
        raise ValueError("The provider did not return a valid email address for this account.")
    key=hashlib.sha256((args.provider+"\0"+address.casefold()).encode()).hexdigest()
    with account_lock(key) as path:
        old=get_account(path) if path.exists() else {}
        if old and old.get("state")!="cursor_expired":
            cursor=old["cursor"]
            since=old["since"]
        else:
            since=time.time()
            cursor=module.baseline(initial["access_token"])
        doc={"id":key,"provider":args.provider,"email":address,"sender":sender,"cursor":cursor,
             "since":since,"state":"connected","error":"","lastSync":old.get("lastSync")}
        if not old:
            # Establish ownership before inserting a keychain item. A crash can be recovered by reconnect/disconnect.
            atomic_save(path,{**doc,"state":"reconnect","error":"Mail account authorization is incomplete."})
        try:
            vault("put",key,initial)
        except Exception:
            if not old:path.unlink(missing_ok=True)
            raise
        atomic_save(path,doc)
    return {"account":public(doc),"accounts":status()}


def deliver(account,message):
    if float(message["time"])<account["since"]:
        return False
    parsed=email.utils.parseaddr(message.get("sender",""))[1].casefold()
    if account["sender"] and parsed!=account["sender"]:
        return False
    sender=" ".join((message.get("sender","") or "").split())
    sender="".join(char for char in sender if char.isprintable()) or "Unknown sender"
    title=" ".join(str(message.get("subject","")).split()) or "No subject"
    title="".join(char for char in title if char.isprintable())[:140] or "No subject"
    uid=str(message["id"])
    event_id=account["id"]+"/"+hashlib.sha256(uid.encode()).hexdigest()
    stamp=float(message["time"])
    arrived=datetime.datetime.fromtimestamp(stamp).astimezone().strftime("%Y-%m-%d %H:%M")
    link=message.get("link") or ""
    if account["provider"]=="gmail":
        link="https://mail.google.com/mail/u/?"+urllib.parse.urlencode({"authuser":account["email"]})+"#inbox/"+urllib.parse.quote(uid,safe="")
    event={"version":1,"source":PROVIDERS[account["provider"]],"eventID":event_id,
           "title":title,"summary":f"From: {sender[:500]}\nReceived: {arrived}","time":stamp,"link":link}
    return publish_event(event,INCOMING)[1]


def sync_account(path):
    key=path.stem
    with account_lock(key) as path:
        if not path.is_file():return 0
        account=get_account(path)
        if account.get("state") in ("reconnect","cursor_expired") or account.get("retryAfter",0)>time.time():
            return 0
        n=0
        try:
            module=importlib.import_module(account["provider"])
            auth=vault("get",key)
            def refresh():
                reply=module.refresh(auth["client_id"],auth["refresh_token"],auth.get("client_secret",""))
                updated=tokens(auth,reply)
                vault("put",key,updated)
                return updated
            refreshed=False
            if auth["expires"]<time.time()+90:
                auth=refresh()
                refreshed=True
            try:
                messages,cursor=module.changes(auth["access_token"],account["cursor"])
            except mail_http.HTTPError as error:
                if error.code!=401 or refreshed:raise
                auth=refresh()
                messages,cursor=module.changes(auth["access_token"],account["cursor"])
            for message in messages:
                n+=int(deliver(account,message))
            account.update(cursor=cursor,state="connected",error="",lastSync=time.time(),retryAfter=0)
        except VaultNeedsReconnect as exc:
            account.update(state="reconnect",error=str(exc))
        except mail_http.CursorExpired as exc:
            account.update(state="cursor_expired",error=str(exc))
        except mail_http.HTTPError as exc:
            disabled=(exc.code==401 or exc.reason in ("invalid_grant","invalid_client","interaction_required"))
            account.update(state="reconnect" if disabled else "retry",error=str(exc))
            if exc.retry_after:
                account["retryAfter"]=time.time()+exc.retry_after
        except (ValueError,OSError,mail_http.OAuthError,KeyError,subprocess.SubprocessError):
            account.update(state="retry",error="Sync is unavailable. Check your connection, unlock Keychain, or reconnect the account.")
        atomic_save(path,account)
        return n


def read_credentials(args):
    if args.credentials_file:
        if args.credentials_stdin:
            raise ValueError("Choose one way to supply the OAuth client configuration.")
        with open(args.credentials_file,"rb") as file: data=file.read(65537)
    elif args.credentials_stdin:
        data=sys.stdin.buffer.read(65537)
    else:
        return {}
    if len(data)>65536:raise ValueError("The OAuth client JSON is too large.")
    parsed=json.loads(data)
    if not isinstance(parsed,dict):raise ValueError("Invalid OAuth client JSON.")
    return parsed


def cli():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="operation",required=True)
    sub.add_parser("status");sub.add_parser("sync")
    c=sub.add_parser("connect")
    c.add_argument("--provider",choices=PROVIDERS,required=True)
    c.add_argument("--client-id",default="")
    c.add_argument("--sender",default="")
    c.add_argument("--credentials-stdin",action="store_true")
    c.add_argument("--credentials-file")
    for name in ("disconnect","set-sender"):
        p=sub.add_parser(name);p.add_argument("--account",required=True)
        if name=="set-sender":p.add_argument("--sender",default="")
        else:p.add_argument("--purge",action="store_true")
    args=parser.parse_args()
    if args.operation in ("connect","sync","disconnect") and VAULT_CHANNEL is None:
        raise ValueError("Use the mail connector in Shishi to manage account authorization.")
    if args.operation=="status":
        accounts=status()
        return {"accounts":accounts,"defaultConfigured":public_configuration(),"connected":bool(accounts)}
    if args.operation=="connect":return connect(args,read_credentials(args))
    if args.operation=="sync":
        created=0
        deadline=time.monotonic()+110
        # Rotate busy accounts according to their last completed check.
        accounts=sorted(status(),key=lambda row:row.get("lastSync") or 0)
        for account in accounts:
            if time.monotonic()>=deadline:break
            created+=sync_account(ACCOUNTS/(account["id"]+".json"))
        return {"accounts":status(),"created":created}
    purged=0
    with account_lock(args.account) as path:
        if args.operation=="disconnect":
            account=get_account(path)
            vault("delete",args.account)
            if args.purge:purged=purge_deliveries(account)
            path.unlink(missing_ok=True)
        else:
            account=get_account(path)
            account["sender"]=checked_sender(args.sender)
            atomic_save(path,account)
    return {"accounts":status(),"purged":purged}


def find_publisher():
    spec=importlib.util.spec_from_file_location("shishi_sender",HERE.parent/"Connectors/shishi-send.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.publish


publish_event=find_publisher()
if __name__=="__main__":
    try:
        print(json.dumps({"ok":True,**cli()},ensure_ascii=False))
    except (ValueError,OSError,KeyError,TypeError,mail_http.OAuthError,mail_http.CursorExpired,
            subprocess.SubprocessError) as exc:
        # Unhandled OS/parse failures must not echo account data, URLs or credentials.
        message=str(exc) if isinstance(exc,(mail_http.OAuthError,mail_http.CursorExpired)) or type(exc) is ValueError else "Connection failed. Check the app configuration and try again."
        print(json.dumps({"ok":False,"error":message[:300]},ensure_ascii=False))
        sys.exit(1)
