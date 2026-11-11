#!/usr/bin/env python3
"""Start a freshly built Shishi.app with sample data and confirm it stays up.

Runs on a macOS build machine. It publishes sample agent states and a result through the same
scripts the Claude Code hooks use, so the whole path from hook to window is exercised.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
app = Path(sys.argv[1]).resolve()
shots = Path(sys.argv[2]).resolve()
shots.mkdir(parents=True, exist_ok=True)
support = Path.home() / "Library/Application Support/ShiShiDesk"
support.mkdir(parents=True, exist_ok=True)
python = app / "Contents/MacOS/shishi-python"
resources = app / "Contents/Resources"



def sample_workspace():
    """Dates in the sample are day offsets such as "@1", so the lists always look current."""
    import datetime
    import re
    today = datetime.date.today()
    text = (ROOT / "Tests/ci/sample-workspace.json").read_text()
    return re.sub(r'"@(-?\d+)', lambda m: '"' + (today + datetime.timedelta(days=int(m.group(1)))).isoformat(), text)


(support / "Workspace.json").write_text(sample_workspace())


def hook(**event):
    event = {"session_id": "ci-session", "cwd": "/Users/me/code/small-tool", **event}
    subprocess.run([str(python), "-B", str(resources / "ClaudeCode/receive.py")], input=json.dumps(event),
                   text=True, check=True, timeout=30)


def shot(name):
    subprocess.run(["screencapture", "-x", str(shots / name)], check=False, timeout=30)


def launch(*flags):
    process = subprocess.Popen([str(app / "Contents/MacOS/ShiShi"), *flags])
    time.sleep(8)
    if process.poll() is not None:
        raise SystemExit(f"Shishi exited during launch with status {process.returncode} (flags: {flags}).")
    return process


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


subprocess.run(["defaults", "write", "local.shishi.workdesk", "ShiShiShowsResults", "-bool", "false"], check=False)
hook(hook_event_name="UserPromptSubmit", prompt="Refactor the billing module and add tests")
hook(hook_event_name="Stop", session_id="ci-finished", prompt_id="p1",
     last_assistant_message="Updated `billing.py` and added 12 tests. All checks pass.")

workspace = launch("--workspace")
shot("workspace.png")
# A new state while the app runs must be picked up from the watched folder.
hook(hook_event_name="Notification", notification_type="permission_prompt",
     message="Claude needs your permission to use Bash")
time.sleep(3)
shot("workspace-needs-you.png")
if workspace.poll() is not None:
    raise SystemExit("Shishi exited while receiving an agent update.")
stop(workspace)

today = launch("--compact-workspace")
shot("today.png")
stop(today)

inbox = launch("--workspace", "--open-inbox")
shot("inbox.png")
stop(inbox)

status = subprocess.run([str(python), "-B", str(resources / "ClaudeCode/install.py"), "install", "--json",
                         "--claude-home", str(shots.parent / "claude-home")], capture_output=True, text=True, timeout=60)
print(status.stdout.strip())
if not json.loads(status.stdout).get("working"):
    raise SystemExit("The bundled Claude Code installer did not produce a working hook.")
print("Launch check passed.")
