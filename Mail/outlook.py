"""Microsoft Graph connector for new Inbox mail in a personal or work account.

Register a Microsoft Entra *Mobile and desktop applications* public client with
http://localhost/callback. The browser uses that host with a dynamic loopback
port. Microsoft ignores the port for the localhost redirect comparison.
"""
import re
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit

import mail_http

NAME = "Outlook"
IDENTITY = "https://login.microsoftonline.com/common/oauth2/v2.0"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPE = "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadBasic"
MAIL_HOSTS = {"outlook.live.com", "outlook.office.com", "outlook.office365.com"}


def authorization(client_id, redirect_uri, challenge, state):
    return IDENTITY + "/authorize?" + urlencode({
        "client_id": client_id, "response_type": "code", "response_mode": "query",
        "redirect_uri": redirect_uri, "scope": SCOPE, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
        "prompt": "select_account",
    })


def exchange(client_id, code, redirect_uri, verifier, client_secret=""):
    # A desktop public client sends the PKCE verifier, with no client secret.
    return mail_http.post_form(IDENTITY + "/token", {
        "grant_type": "authorization_code", "client_id": client_id, "code": code,
        "redirect_uri": redirect_uri, "code_verifier": verifier, "scope": SCOPE,
    })


def refresh(client_id, refresh_token, client_secret=""):
    return mail_http.post_form(IDENTITY + "/token", {
        "grant_type": "refresh_token", "client_id": client_id,
        "refresh_token": refresh_token, "scope": SCOPE,
    })


def identity(access_token):
    profile = mail_http.get_json(GRAPH + "/me?$select=mail,userPrincipalName", access_token)
    email = profile.get("mail") or profile.get("userPrincipalName")
    if not isinstance(email, str) or not email.strip():
        raise mail_http.OAuthError("Microsoft did not return an email address for this account.")
    return email.strip()


def baseline(access_token):
    # Mail delta does not implement $deltatoken=latest. Begin an official filtered
    # delta collection at the connection time; the first poll can safely be retried.
    now = datetime.now(timezone.utc)
    start = now.isoformat(timespec="microseconds").replace("+00:00", "Z")
    query = urlencode({
        "changeType": "created",
        "$filter": "receivedDateTime ge " + start,
        "$select": "id,subject,from,receivedDateTime,webLink",
        "$top": 50,
    })
    return {"url": GRAPH + "/me/mailFolders/inbox/messages/delta?" + query,
            "since": now.timestamp(), "hasMore": True}


def _graph_link(url):
    # Pagination URLs carry an opaque token. Never attach a bearer token to
    # a different origin, even if its URL came from a checkpoint on disk.
    if not isinstance(url, str) or not url or "\\" in url or any(c.isspace() for c in url):
        raise mail_http.OAuthError("Microsoft returned an invalid mail sync URL.")
    try:
        parsed = urlsplit(url)
        path = parsed.path.lower()
        if (parsed.scheme == "https" and parsed.netloc.lower() == "graph.microsoft.com"
                and path.startswith("/v1.0/") and "/mailfolders" in path
                and "/messages/" in path and "delta" in path.rsplit("/", 1)[-1] and not parsed.fragment):
            return url
    except ValueError:
        pass
    raise mail_http.OAuthError("Microsoft returned an invalid mail sync URL.")


def _web_link(url):
    if isinstance(url, str) and "\\" not in url and not any(c.isspace() for c in url):
        try:
            parsed = urlsplit(url)
            if parsed.scheme == "https" and parsed.netloc.lower() in MAIL_HOSTS:
                return url
        except ValueError:
            pass
    return ""


def _received(value):
    if not isinstance(value, str):
        return None
    # Graph permits seven fractional digits. CPython 3.9 fromisoformat only
    # accepts three or six. Normalize this piece without discarding the zone.
    value = re.sub(r"\.(\d+)", lambda m: "." + m[1][:6].ljust(6, "0"), value, count=1)
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if date.tzinfo is not None:
            return date.timestamp()
    except (ValueError, OverflowError):
        pass
    return None


def changes(access_token, cursor):
    try:
        result = mail_http.get_json(_graph_link(cursor["url"]), access_token,
                                    {"Prefer": 'IdType="ImmutableId"'})
    except mail_http.HTTPError as error:
        if error.status == 410:
            raise mail_http.CursorExpired("The saved Outlook sync position has expired. Reconnect this account to start from new messages.") from error
        raise
    values = result.get("value")
    if not isinstance(values, list):
        raise mail_http.OAuthError("Microsoft did not return a list of inbox messages.")
    next_page = result.get("@odata.nextLink")
    next_cursor = {"url": _graph_link(next_page or result.get("@odata.deltaLink")),
                   "since": cursor["since"], "hasMore": bool(next_page)}
    messages = []
    for row in values:
        # Graph can return a removal or an isRead-only update even with a
        # changeType and a receivedDateTime filter. Neither is a new message.
        if not isinstance(row, dict) or "@removed" in row:
            continue
        received = _received(row.get("receivedDateTime"))
        if received is None or received < cursor["since"]:
            continue
        if not isinstance(row.get("id"), str) or not row["id"]:
            continue
        address = (row.get("from") or {}).get("emailAddress") or {}
        name = address.get("name") or ""
        email = address.get("address") or ""
        sender = (f"{name} <{email}>" if name and email and name != email else email or name)
        messages.append({"id": row["id"], "subject": row.get("subject") or "(No subject)",
                         "sender": sender or "(Unknown sender)", "time": received,
                         "link": _web_link(row.get("webLink"))})
    return messages, next_cursor
