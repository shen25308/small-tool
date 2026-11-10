"""HTTPS transport shared by both public OAuth clients. Never log tokens or response bodies."""
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request


def has_legacy_status(message):
    return bool(re.search(r"[\u3400-\u9fff]", message))


class OAuthError(Exception):
    pass


class CursorExpired(Exception):
    pass


class HTTPError(OAuthError):
    def __init__(self, code, reason="", retry_after=0):
        self.code = self.status = code
        self.reason = reason
        self.retry_after = retry_after
        super().__init__(f"The mail service returned HTTP {code}"+(f" ({reason})" if reason else ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


CLIENT = urllib.request.build_opener(NoRedirect())
HOSTS = {"gmail.googleapis.com", "oauth2.googleapis.com", "graph.microsoft.com", "login.microsoftonline.com"}


def request(url, *, token=None, form=None, extra_headers=None):
    target = urllib.parse.urlsplit(url)
    if target.scheme != "https" or target.hostname not in HOSTS or target.netloc.lower() not in HOSTS:
        raise OAuthError("The mail service returned an unsupported URL.")
    headers = {"Accept": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if form is None else urllib.parse.urlencode(form).encode()
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with CLIENT.open(req, timeout=18) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw)>4 * 1024 * 1024:
                raise OAuthError("The mail service response was too large. Try again.")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise OAuthError("The mail service returned an invalid response.")
            return result
    except urllib.error.HTTPError as exc:
        reason = ""
        try:
            details = json.loads(exc.read(32768)).get("error")
            details = details.get("code") if isinstance(details,dict) else details
            if isinstance(details,str) and len(details)<80 and all(c.isalnum() or c in "_-." for c in details):
                reason = details
        except (ValueError, AttributeError):
            pass
        retry = exc.headers.get("Retry-After","0")
        raise HTTPError(exc.code,reason, int(retry) if retry.isdecimal() and len(retry)<10 else 0) from None
    except (OSError, socket.timeout, ValueError, UnicodeDecodeError) as exc:
        raise OAuthError("Could not reach the mail service. Check your connection and sync again.") from None


def post_form(url, fields):
    return request(url,form=fields)


def get_json(url, token, headers=None):
    return request(url,token=token,extra_headers=headers)
