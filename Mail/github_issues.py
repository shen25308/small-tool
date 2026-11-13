#!/usr/bin/env python3
"""List a public GitHub repository's issues, optionally only those assigned to one person or with one label.

The app sends {"repo": "owner/name", "assignee": "login", "label": "bug"} on stdin and turns open issues into
tasks; a task is completed when its issue closes. No credentials: public repositories only, and GitHub allows
about 60 such requests an hour, so Shishi asks every 15 minutes. Prints one JSON object.
"""
import json
import re
import sys
import unicodedata
from datetime import datetime
from urllib import error, parse, request

from mail_http import NoRedirect

API = "https://api.github.com"
OPENER = request.build_opener(NoRedirect())


def clean(raw, limit):
    value = "".join(" " if unicodedata.category(ch) in {"Cc", "Cf"} else ch for ch in str(raw or ""))
    return " ".join(value.split())[:limit]


def stamp(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def validate(command):
    repo = command.get("repo") if isinstance(command, dict) else None
    if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}", repo.strip()) \
            or repo.strip().split("/")[1] in {".", ".."}:
        raise ValueError("Enter a public GitHub repository as owner/repo.")
    assignee = str(command.get("assignee") or "").strip().lstrip("@")
    if assignee and not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})", assignee):
        raise ValueError("That is not a GitHub user name.")
    label = clean(command.get("label"), 50)
    return repo.strip(), assignee, label


MAX_PAGES = 10


def get_page(url):
    req = request.Request(url, headers={"User-Agent": "Shishi-Desktop", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with OPENER.open(req, timeout=10) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            link = response.headers.get("Link", "") or ""
    except error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError("Check that the repository exists and is public.") from None
        if exc.code in (403, 429):
            raise ValueError("GitHub is limiting requests for now. Shishi will try again later.") from None
        if exc.code in (301, 302, 307, 308):
            raise ValueError("The repository was renamed. Use its current name.") from None
        raise ValueError(f"GitHub could not list the issues (HTTP {exc.code}).") from None
    except OSError:
        raise ValueError("Could not reach GitHub. Check your connection and try again.") from None
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("The GitHub response was too large.")
    rows = json.loads(raw)
    if not isinstance(rows, list):
        raise ValueError("GitHub returned an unexpected response.")
    found = re.search(r'<(https://api\.github\.com/[^>]+)>;\s*rel="next"', link)
    return rows, found.group(1) if found else ""


def fetch(repo, assignee, label, state="open", pages=MAX_PAGES):
    """Every open issue, following GitHub's next-page links (C03), or as many pages as allowed.
    Returns (rows, complete): complete is False when more pages were left unread."""
    query = {"state": state, "sort": "updated", "direction": "desc", "per_page": 100}
    if assignee:
        query["assignee"] = assignee
    if label:
        query["labels"] = label
    url, rows = API + "/repos/" + repo + "/issues?" + parse.urlencode(query), []
    for _ in range(pages):
        page, url = get_page(url)
        rows.extend(page)
        if not url:
            return rows, True
    return rows, False


def issues(rows, repo):
    found = []
    for row in rows:
        if not isinstance(row, dict) or "pull_request" in row or not isinstance(row.get("number"), int):
            continue
        state = row.get("state")
        if state not in ("open", "closed"):
            continue
        found.append({"number": row["number"], "title": clean(row.get("title"), 240) or "Issue #" + str(row["number"]),
                      "state": state, "url": "https://github.com/" + repo + "/issues/" + str(row["number"]),
                      "updated": stamp(row.get("updated_at")),
                      "labels": [clean(label.get("name"), 40) for label in row.get("labels") or [] if isinstance(label, dict)][:5]})
    return found


def main():
    try:
        repo, assignee, label = validate(json.load(sys.stdin))
        open_rows, complete = fetch(repo, assignee, label, "open")
        # Recently closed issues let linked tasks complete; one page is enough for a sync every 15 minutes.
        closed_rows, _ = fetch(repo, assignee, label, "closed", pages=1)
        result = {"ok": True, "repo": repo, "issues": issues(open_rows + closed_rows, repo), "complete": complete,
                  "openPagesRead": min(MAX_PAGES, len(open_rows) // 100 + 1)}
    except ValueError as problem:
        result = {"ok": False, "error": str(problem)}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
