#!/usr/bin/env python3
"""Answer a Claude Code permission request from Shishi's card. Installed only when you turn it on.

Claude Code runs this hook before it asks you for permission to use a tool. When Shishi is open, the request
appears on the card for a short time (25 seconds unless you chose otherwise). Allow or Deny there answers Claude
Code. If nobody answers, or Shishi is closed, this exits without output and Claude Code asks in the terminal
exactly as it would without Shishi. It never allows anything on its own.
"""
import json
import os
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHARED = HERE if (HERE / "shishi_agents.py").is_file() else HERE.parent / "Connectors"
sys.path.insert(0, str(SHARED))
import shishi_agents as agents  # noqa: E402

SOURCE = "Claude Code"
DEFAULT_WAIT = 25
ALIVE_SECONDS = 30


def folder():
    return agents.directory().parent / "Approvals"


def text(value):
    return value if isinstance(value, str) else ""


def shishi_is_open(base):
    """Shishi touches this file every few seconds while it runs."""
    try:
        return time.time() - (base / ".alive").stat().st_mtime < ALIVE_SECONDS
    except OSError:
        return False


def wait_seconds(base):
    try:
        value = json.loads((base / "settings.json").read_text(encoding="utf-8")).get("wait")
    except (OSError, ValueError, AttributeError):
        value = None
    return value if isinstance(value, int) and 5 <= value <= 120 else DEFAULT_WAIT


def describe(event):
    """What Claude wants to do, in full, so the decision is made on the real command and not a summary."""
    tool = text(event.get("tool_name"))[:80] or "a tool"
    data = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    if tool == "Bash":
        detail = text(data.get("command"))
    else:
        detail = text(data.get("file_path")) or text(data.get("notebook_path")) or text(data.get("url")) or text(data.get("path"))
        if not detail and data:
            detail = json.dumps(data, ensure_ascii=False, sort_keys=True)
    return tool, detail[:4000], text(data.get("description"))[:300]


def write_json(path, value):
    pending = path.with_name("." + path.name + ".pending")
    pending.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(pending, path)


def decision(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    behavior = value.get("behavior") if isinstance(value, dict) else None
    return behavior if behavior in ("allow", "deny") else None


def ask(event, clock=time.monotonic, sleep=time.sleep):
    """Returns "allow", "deny", or None when Claude Code should ask in the terminal."""
    if not isinstance(event, dict) or event.get("agent_id"):
        return None
    session = text(event.get("session_id"))
    base = folder()
    if not session or not shishi_is_open(base):
        return None
    tool, detail, reason = describe(event)
    project = Path(text(event.get("cwd"))).name or "session"
    wait = wait_seconds(base)
    request_id = uuid.uuid4().hex
    request = base / (request_id + ".json")
    answer = base / (request_id + ".decision")
    base.mkdir(parents=True, mode=0o700, exist_ok=True)
    write_json(request, {"id": request_id, "session": session, "source": SOURCE, "project": project, "tool": tool,
                         "detail": detail, "reason": reason, "time": time.time(), "expires": time.time() + wait})
    previous = agents.read(SOURCE, session) or {}
    keep = {key: previous[key] for key in ("label", "app", "started", "pid", "task") if key in previous}
    title = text(previous.get("title")) or SOURCE + " · " + project
    agents.write(SOURCE, session, "attention", title, ("Wants to use " + tool + (": " + detail if detail else ""))[:400],
                 {**keep, "approval": request_id})
    deadline = clock() + wait
    try:
        while clock() < deadline:
            behavior = decision(answer)
            if behavior:
                return behavior
            if not request.exists():
                return None  # Answered in the terminal: the tool ran and the hook removed the request.
            sleep(0.2)
        return None
    finally:
        request.unlink(missing_ok=True)
        answer.unlink(missing_ok=True)


def output(behavior):
    result = {"behavior": behavior}
    if behavior == "deny":
        result["message"] = "Denied from Shishi."
    return {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": result}}


if __name__ == "__main__":
    try:
        behavior = ask(json.load(sys.stdin))
    except (OSError, ValueError, TypeError, AttributeError) as problem:
        print(f"Shishi approvals: {problem}", file=sys.stderr)
        behavior = None
    if behavior:
        print(json.dumps(output(behavior)))
    # No output: Claude Code shows its own permission prompt as usual.
    sys.exit(0)
