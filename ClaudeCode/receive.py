#!/usr/bin/env python3
"""Turn Claude Code hook events into a live status and a quiet Shishi receipt.

Claude Code passes one JSON event on standard input. This script never asks Claude to continue:
it exits 0 on success and 1 on a delivery problem, and it prints nothing to standard output.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Installed copies sit in one folder. In the app bundle and the repository they are siblings.
SHARED = HERE if (HERE / "shishi_agents.py").is_file() else HERE.parent / "Connectors"
sys.path.insert(0, str(SHARED))
import shishi_agents as agents  # noqa: E402

SOURCE = "Claude Code"
MAX_SUMMARY_BYTES = 60 * 1024
NEEDS_USER = {"permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"}


def text(value):
    return value if isinstance(value, str) else ""


def title_for(event, previous):
    name = text(event.get("session_title")).strip() or text(previous.get("label")).strip()
    folder = Path(text(event.get("cwd"))).name
    return SOURCE + " · " + (name or folder or "session"), name


def last_reply(transcript):
    """Older Claude Code versions omit last_assistant_message. Read it from the transcript."""
    path = Path(transcript)
    if not transcript or not path.is_file():
        return ""
    size = path.stat().st_size
    with path.open("rb") as stream:
        stream.seek(max(0, size - 2 * 1024 * 1024))
        lines = stream.read().splitlines()
    for line in reversed(lines):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or row.get("type") != "assistant" or row.get("isSidechain"):
            continue
        content = (row.get("message") or {}).get("content")
        if isinstance(content, str):
            parts = [content]
        else:
            parts = [text(part.get("text")) for part in content or []
                     if isinstance(part, dict) and part.get("type") == "text"]
        reply = "\n".join(part for part in parts if part.strip()).strip()
        if reply:
            return reply
    return ""


def shorten(value, limit):
    data = value.encode("utf-8")
    if len(data) <= limit:
        return value
    return data[:limit].decode("utf-8", errors="ignore").rstrip() + "\n…"


def deliver(title, summary, event_id):
    command = [sys.executable, "-B", str(SHARED / "shishi-send.py"), "--source", SOURCE, "--title", title, "--event-id", event_id]
    # The reply travels on standard input so it never appears in a process listing.
    result = subprocess.run(command, input=summary, text=True, encoding="utf-8",
                            stdout=subprocess.DEVNULL, timeout=8)
    if result.returncode:
        raise RuntimeError("Could not deliver the Claude Code reply to Shishi.")


def receive(event):
    if not isinstance(event, dict):
        raise ValueError("The hook event is not a JSON object.")
    name = text(event.get("hook_event_name"))
    session = text(event.get("session_id"))
    # Subagent events carry an agent_id. Only the main conversation reports to Shishi.
    if not session or event.get("agent_id"):
        return
    previous = agents.read(SOURCE, session) or {}
    title, label = title_for(event, previous)
    keep = {"label": label} if label else {}

    if name == "UserPromptSubmit":
        prompt = agents.clean(event.get("prompt"), "detail", required=False)
        agents.write(SOURCE, session, "working", title, prompt, {**keep, "task": prompt})
    elif name == "PostToolUse":
        # A tool ran, so a pending permission request has been answered.
        if previous.get("state") == "attention":
            task = text(previous.get("task"))
            agents.write(SOURCE, session, "working", title, task, {**keep, "task": task})
    elif name == "Notification":
        if text(event.get("notification_type")) not in NEEDS_USER:
            return
        task = text(previous.get("task"))
        agents.write(SOURCE, session, "attention", title,
                     text(event.get("message")) or "Claude Code is waiting for you.", {**keep, "task": task})
    elif name == "Stop":
        summary = text(event.get("last_assistant_message")).strip() or last_reply(text(event.get("transcript_path")))
        summary = shorten(summary, MAX_SUMMARY_BYTES) or "Claude Code finished this turn."
        # A background task can wake the same prompt again. Each distinct reply gets its own receipt.
        identity = [session, text(event.get("prompt_id")), hashlib.sha256(summary.encode("utf-8")).hexdigest()]
        event_id = hashlib.sha256(json.dumps(identity).encode("utf-8")).hexdigest()
        deliver(title, summary, event_id)
        receipt = hashlib.sha256((SOURCE + "\0" + event_id).encode("utf-8")).hexdigest()
        agents.write(SOURCE, session, "done", title, summary, {**keep, "receipt": "connector/" + receipt})
    elif name == "SessionEnd":
        # A finished result stays visible until it is read or dismissed in Shishi.
        if previous.get("state") != "done":
            agents.clear(SOURCE, session)


if __name__ == "__main__":
    try:
        receive(json.load(sys.stdin))
    except (OSError, ValueError, TypeError, AttributeError, RuntimeError, subprocess.TimeoutExpired) as problem:
        print(f"Shishi connector: {problem}", file=sys.stderr)
        # Exit status 2 would ask Claude to keep working. A delivery problem must never do that.
        sys.exit(1)
