#!/usr/bin/env python3
"""Sync Shishi tasks with one Notion database. Reads a JSON request on stdin, prints one JSON object.

Shishi supplies the integration secret from the Keychain for each run. This helper stores nothing.
"""
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request

API = "https://api.notion.com/v1"
VERSION = "2022-06-28"
MAX_PAGES = 1000
MAX_CHANGES = 100
DONE_NAMES = ("done", "completed", "complete", "finished", "checked")
DUE_NAMES = ("due", "due date", "deadline", "date", "do date", "when")
TAG_NAMES = ("tags", "tag", "labels", "label", "category", "type", "area")
PRIORITY_WORDS = {"P0": ("p0", "high", "urgent", "critical"), "P1": ("p1", "medium", "normal"), "P2": ("p2", "low")}


class NotionError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


CLIENT = urllib.request.build_opener(NoRedirect())
MESSAGES = {
    400: "Notion did not accept this change. Check that the database still has its task columns.",
    401: "Notion rejected the integration secret. Disconnect and connect again with a current secret.",
    403: "This integration is not allowed to edit the database. Give it edit access in Notion.",
    404: "Notion could not find the database. Open it in Notion, choose ••• → Connections, and add your integration.",
    409: "Notion reported a conflicting edit. Sync again.",
}


def call(method, path, token, body=None, attempts=3):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": "Bearer " + token, "Notion-Version": VERSION, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    for attempt in range(attempts):
        request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
        try:
            with CLIENT.open(request, timeout=20) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise NotionError("The Notion response was too large.")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise NotionError("Notion returned an unexpected response.")
            return result
        except urllib.error.HTTPError as problem:
            if problem.code in (429, 502, 503) and attempt + 1 < attempts:
                wait = problem.headers.get("Retry-After", "")
                time.sleep(min(float(wait) if wait.replace(".", "", 1).isdigit() else 1.5, 8))
                continue
            if problem.code == 429:
                raise NotionError("Notion is limiting requests right now. Sync again in a minute.") from None
            raise NotionError(MESSAGES.get(problem.code, f"Notion returned an error ({problem.code}). Try again later.")) from None
        except (OSError, socket.timeout, ValueError) as problem:
            if isinstance(problem, NotionError):
                raise
            raise NotionError("Could not reach Notion. Check your connection and sync again.") from None
    raise NotionError("Could not reach Notion. Check your connection and sync again.")


def database_id(text):
    """Accept a database ID or the link copied from Notion. The view ID after ?v= is ignored."""
    location = str(text or "").strip().split("?")[0].split("#")[0]
    found = re.findall(r"[0-9a-fA-F]{8}-?(?:[0-9a-fA-F]{4}-?){3}[0-9a-fA-F]{12}", location)
    if not found:
        raise NotionError("Paste the link to a Notion database, or its 32-character ID.")
    plain = found[-1].replace("-", "").lower()
    return "-".join((plain[:8], plain[8:12], plain[12:16], plain[16:20], plain[20:]))


def plain_text(parts):
    return "".join(part.get("plain_text", "") for part in parts or [] if isinstance(part, dict)).strip()


def pick(properties, kinds, names, fallback=True):
    """Prefer a well-known column name. Otherwise use the first column of the right kind."""
    candidates = [(name, prop) for name, prop in properties.items() if prop.get("type") in kinds]
    for wanted in names:
        for name, prop in candidates:
            if name.strip().lower() == wanted:
                return name, prop
    return candidates[0] if candidates and fallback else (None, None)


def describe(database):
    """Map the database's columns to task fields."""
    properties = database.get("properties") or {}
    title = next((name for name, prop in properties.items() if prop.get("type") == "title"), None)
    if not title:
        raise NotionError("This Notion page is not a database with a title column.")
    mapping = {"title": title}
    name, prop = pick(properties, ("checkbox",), DONE_NAMES)
    status_name, status = pick(properties, ("status",), ("status",))
    if name and (name.strip().lower() in DONE_NAMES or not status_name):
        mapping["done"] = {"name": name, "type": "checkbox"}
    elif status_name:
        detail = status.get("status") or {}
        options = {option.get("id"): option.get("name") for option in detail.get("options") or []}
        complete, first_open = [], ""
        for group in detail.get("groups") or []:
            names = [options[item] for item in group.get("option_ids") or [] if options.get(item)]
            if group.get("name") == "Complete":
                complete = names
            elif group.get("name") == "To-do" and names:
                first_open = names[0]
        if complete:
            remaining = [value for value in options.values() if value not in complete]
            mapping["done"] = {"name": status_name, "type": "status", "complete": complete,
                               "open": first_open or (remaining[0] if remaining else "")}
    name, _ = pick(properties, ("date",), DUE_NAMES)
    if name:
        mapping["due"] = name
    name, prop = pick(properties, ("select",), ("priority",), fallback=False)
    if name:
        mapping["priority"] = {"name": name,
                               "options": [option.get("name", "") for option in (prop.get("select") or {}).get("options") or []]}
    name, prop = pick(properties, ("multi_select", "select"), TAG_NAMES, fallback=False)
    if name:
        mapping["tag"] = {"name": name, "type": prop["type"]}
    return mapping


def priority_from(name):
    word = str(name or "").strip().lower()
    return next((level for level, words in PRIORITY_WORDS.items() if word in words), "")


def priority_option(level, options):
    lowered = {option.lower(): option for option in options}
    for word in PRIORITY_WORDS.get(level, ()):
        if word in lowered:
            return lowered[word]
    return level


def page_fields(page, mapping):
    properties = page.get("properties") or {}
    def prop(name):
        value = properties.get(name)
        return value if isinstance(value, dict) else {}
    row = {"id": page.get("id", ""), "url": page.get("url", ""), "edited": page.get("last_edited_time", ""),
           "title": plain_text(prop(mapping["title"]).get("title")), "done": False, "due": "", "priority": "", "tag": ""}
    done = mapping.get("done")
    if done and done["type"] == "checkbox":
        row["done"] = prop(done["name"]).get("checkbox") is True
    elif done:
        row["done"] = ((prop(done["name"]).get("status") or {}).get("name") or "") in done.get("complete", [])
    if mapping.get("due"):
        row["due"] = ((prop(mapping["due"]).get("date") or {}).get("start") or "")
    if mapping.get("priority"):
        row["priority"] = priority_from((prop(mapping["priority"]["name"]).get("select") or {}).get("name"))
    tag = mapping.get("tag")
    if tag and tag["type"] == "multi_select":
        values = prop(tag["name"]).get("multi_select") or []
        row["tag"] = values[0].get("name", "") if values else ""
    elif tag:
        row["tag"] = (prop(tag["name"]).get("select") or {}).get("name") or ""
    return row


def properties_for(fields, mapping):
    """Build a Notion property update from the task fields that changed."""
    result = {}
    if "title" in fields:
        result[mapping["title"]] = {"title": [{"type": "text", "text": {"content": str(fields["title"])[:1900]}}]}
    done = mapping.get("done")
    if "done" in fields and done:
        if done["type"] == "checkbox":
            result[done["name"]] = {"checkbox": bool(fields["done"])}
        else:
            option = done["complete"][0] if fields["done"] else done.get("open")
            if option:
                result[done["name"]] = {"status": {"name": option}}
    if "due" in fields and mapping.get("due"):
        result[mapping["due"]] = {"date": {"start": fields["due"]} if fields["due"] else None}
    priority = mapping.get("priority")
    if "priority" in fields and priority:
        option = priority_option(fields["priority"], priority.get("options") or []) if fields["priority"] else ""
        result[priority["name"]] = {"select": {"name": option} if option else None}
    tag = mapping.get("tag")
    if "tag" in fields and tag:
        label = str(fields["tag"] or "").replace(",", " ").strip()[:100]
        if tag["type"] == "multi_select":
            result[tag["name"]] = {"multi_select": [{"name": label}] if label else []}
        else:
            result[tag["name"]] = {"select": {"name": label} if label else None}
    return result


def connect(request):
    identifier = database_id(request.get("database"))
    database = call("GET", "/databases/" + identifier, request["token"])
    return {"database": identifier, "title": plain_text(database.get("title")) or "Notion tasks",
            "url": database.get("url", ""), "mapping": describe(database)}


def pull(request):
    identifier = database_id(request.get("database"))
    token = request["token"]
    database = call("GET", "/databases/" + identifier, token)
    mapping = describe(database)
    pages, cursor, truncated = [], None, False
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        batch = call("POST", "/databases/" + identifier + "/query", token, body)
        for page in batch.get("results") or []:
            if isinstance(page, dict) and not page.get("archived") and not page.get("in_trash"):
                pages.append(page_fields(page, mapping))
        cursor = batch.get("next_cursor")
        if not batch.get("has_more") or not cursor:
            break
        if len(pages) >= MAX_PAGES:
            truncated = True
            break
    return {"database": identifier, "title": plain_text(database.get("title")) or "Notion tasks",
            "mapping": mapping, "pages": pages, "truncated": truncated}


def push(request):
    identifier = database_id(request.get("database"))
    token, mapping = request["token"], request.get("mapping")
    changes = request.get("changes")
    if not isinstance(mapping, dict) or not isinstance(mapping.get("title"), str) or not isinstance(changes, list):
        raise NotionError("Sync with Notion again before sending changes.")
    results = []
    for change in changes[:MAX_CHANGES]:
        task, page, fields = change.get("task"), change.get("page"), change.get("fields")
        if not isinstance(task, str) or not isinstance(fields, dict):
            continue
        properties = properties_for(fields, mapping)
        try:
            if page:
                if not properties:
                    continue
                saved = call("PATCH", "/pages/" + database_id(page), token, {"properties": properties})
            else:
                if mapping["title"] not in properties:
                    raise NotionError("A new Notion page needs a title.")
                saved = call("POST", "/pages", token, {"parent": {"database_id": identifier}, "properties": properties})
            results.append({"task": task, "ok": True, "page": page_fields(saved, mapping)})
        except NotionError as problem:
            results.append({"task": task, "ok": False, "error": str(problem)})
    return {"results": results, "deferred": max(0, len(changes) - MAX_CHANGES)}


def main():
    try:
        request = json.loads(sys.stdin.buffer.read(4 * 1024 * 1024))
        if not isinstance(request, dict) or not isinstance(request.get("token"), str) or len(request["token"]) < 20:
            raise NotionError("Connect Notion first.")
        handler = {"connect": connect, "pull": pull, "push": push}.get(request.get("op"))
        if not handler:
            raise NotionError("Unsupported Notion action.")
        result = handler(request)
    except NotionError as problem:
        print(json.dumps({"ok": False, "error": str(problem)}))
        return 1
    except (ValueError, KeyError, TypeError, AttributeError):
        print(json.dumps({"ok": False, "error": "Notion returned data Shishi could not read. Sync again."}))
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
