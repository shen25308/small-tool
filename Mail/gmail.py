"""Gmail metadata-only OAuth client and incremental inbox history reader."""
import time
from urllib.parse import quote, urlencode
import mail_http

NAME = "Gmail"
SCOPE = "https://www.googleapis.com/auth/gmail.metadata"
PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me"
TOKEN = "https://oauth2.googleapis.com/token"


def authorization(client_id, redirect_uri, challenge, state):
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id":client_id, "redirect_uri":redirect_uri, "response_type":"code", "scope":SCOPE,
        "access_type":"offline", "prompt":"select_account consent", "state":state,
        "code_challenge":challenge, "code_challenge_method":"S256"
    })


def exchange(client_id, code, redirect_uri, verifier, client_secret=""):
    values = dict(client_id=client_id, code=code, redirect_uri=redirect_uri,
                  code_verifier=verifier, grant_type="authorization_code")
    if client_secret:
        values["client_secret"] = client_secret
    return mail_http.post_form(TOKEN,values)


def refresh(client_id, refresh_token, client_secret=""):
    values = dict(client_id=client_id, refresh_token=refresh_token, grant_type="refresh_token")
    if client_secret:
        values["client_secret"] = client_secret
    return mail_http.post_form(TOKEN,values)


def identity(access_token):
    address = mail_http.get_json(PROFILE+"/profile?fields=emailAddress",access_token).get("emailAddress")
    if not isinstance(address,str) or not address.strip():
        raise mail_http.OAuthError("Google did not return the selected email address.")
    return address


def baseline(access_token):
    head = mail_http.get_json(PROFILE+"/profile?fields=historyId",access_token).get("historyId")
    if not head or not str(head).isdecimal():
        raise mail_http.OAuthError("Google did not return a starting point for inbox sync.")
    return {"historyId":str(head)}


def changes(access_token, cursor):
    if "pending" in cursor:
        ids=cursor["pending"]
        after=cursor["after"]
    else:
        query = {"startHistoryId":cursor["historyId"],"historyTypes":"messageAdded","labelId":"INBOX",
                 "maxResults":25,"fields":"nextPageToken,historyId,history(id,messagesAdded(message(id)))"}
        if cursor.get("page"):
            query["pageToken"] = cursor["page"]
        try:
            data = mail_http.get_json(PROFILE+"/history?"+urlencode(query),access_token)
        except mail_http.HTTPError as error:
            if error.code == 404:
                raise mail_http.CursorExpired("Google no longer has the saved sync history. Reconnect this account to resume with new messages.") from None
            raise
        ids = list(dict.fromkeys(item["message"]["id"] for row in data.get("history",[]) for item in row.get("messagesAdded",[])))
        token=data.get("nextPageToken")
        if not token and not str(data.get("historyId","")).isdecimal():
            raise mail_http.OAuthError("Google did not return a starting point for the next sync.")
        after = {"historyId":cursor["historyId"],"page":token} if token else {"historyId":str(data["historyId"])}
    messages = []
    # A single history entry can describe many incoming messages. Checkpoint every bounded part.
    deadline=time.monotonic()+14
    for index,uid in enumerate(ids):
        if index and (index>=20 or time.monotonic()>=deadline):
            return messages,{"pending":ids[index:],"after":after}
        query = urlencode([("format","metadata"),("metadataHeaders","Subject"),("metadataHeaders","From"),
                           ("fields","id,internalDate,labelIds,payload/headers")])
        try:
            mail = mail_http.get_json(PROFILE+"/messages/"+quote(uid,safe="")+"?"+query, access_token)
        except mail_http.HTTPError as error:
            if error.code==404:  # Deleted between the history lookup and metadata request.
                continue
            raise
        if "INBOX" not in mail.get("labelIds",[]):
            continue
        headers = {h["name"].lower():h.get("value","") for h in mail.get("payload",{}).get("headers",[])}
        messages.append({"id":uid,"sender":headers.get("from",""),"subject":headers.get("subject",""),
                         "time":int(mail["internalDate"])/1000,
                         "link":""})  # The bridge supplies the account-specific Gmail link.
    return messages,after
