#!/usr/bin/env python3
"""Translate a Grok Build Stop event to a local Shishi receipt."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def receive(event):
    name = event.get("hookEventName") or event.get("hook_event_name") or ""
    if name.lower() != "stop" or event.get("reason") != "end_turn" or event.get("subagentType"):
        return
    session = event.get("sessionId")
    prompt = event.get("promptId")
    if not isinstance(session, str) or not session or not isinstance(prompt, str) or not prompt:
        raise ValueError("The Grok Build Stop event is missing its session or turn ID.")
    summary = event.get("lastAssistantMessage") or ""
    if not isinstance(summary, str):
        raise ValueError("The Grok Build reply is in an unsupported format.")
    summary = summary.strip()[:4000] or "Grok Build finished this turn."
    workspace = event.get("workspaceRoot") or event.get("cwd") or ""
    folder = Path(workspace).name if isinstance(workspace, str) else ""
    title = ("Grok Build · " + folder[:110]) if folder else "Grok Build reply"
    event_id = hashlib.sha256(json.dumps([session, prompt], ensure_ascii=False).encode()).hexdigest()
    sender = Path(__file__).with_name("shishi-send.py")
    cmd = [sys.executable, str(sender), "--source", "Grok Build", "--title", title,
           "--event-id", event_id]
    # Summary travels via stdin so it never appears in a process listing.
    result = subprocess.run(cmd, input=summary, text=True,
                            stdout=subprocess.DEVNULL, timeout=5)
    if result.returncode:
        raise RuntimeError("Could not deliver the Grok Build reply to Shishi.")


if __name__ == "__main__":
    try:
        receive(json.load(sys.stdin))
    except (OSError, ValueError, TypeError, AttributeError, RuntimeError, subprocess.TimeoutExpired) as err:
        print(f"Shishi connector: {err}", file=sys.stderr)
        # Grok interprets exit status 2 as a request to keep working.
        sys.exit(1)
