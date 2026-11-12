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


FIND_WINDOW = """
import CoreGraphics
let pid = Int32(CommandLine.arguments[1])!
let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
var best = (id: 0, area: 0.0)
for window in info where (window[kCGWindowOwnerPID as String] as? Int32) == pid {
    guard let bounds = window[kCGWindowBounds as String] as? [String: Double],
          let id = window[kCGWindowNumber as String] as? Int else { continue }
    let area = (bounds["Width"] ?? 0) * (bounds["Height"] ?? 0)
    if area > best.area { best = (id, area) }
}
print(best.id)
"""


def window_id(process):
    script = FIND_WINDOW.replace("CommandLine.arguments[1]", '"' + str(process.pid) + '"')
    try:
        out = subprocess.run(["xcrun", "swift", "-"], input=script, capture_output=True, text=True, timeout=120)
        return int(out.stdout.strip() or 0)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 0


def shot(name, process=None):
    """Capture the app window alone when possible, otherwise the whole screen."""
    wid = window_id(process) if process else 0
    command = ["screencapture", "-x", "-o", "-l", str(wid)] if wid else ["screencapture", "-x"]
    result = subprocess.run(command + [str(shots / name)], check=False, timeout=30)
    if result.returncode and wid:
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
# A small session log, so the report's facts come from what the turn actually did.
log = shots.parent / "ci-session.jsonl"
log.write_text("\n".join(json.dumps(row) for row in [
    {"type": "user", "message": {"content": "Refactor billing and add refund tests"}},
    {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Edit", "input": {"file_path": "/Users/me/code/small-tool/billing.py"}}]}},
    {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}},
    {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t2", "name": "Write", "input": {"file_path": "/Users/me/code/small-tool/tests/test_refunds.py"}}]}},
    {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t2", "content": "ok"}]}},
    {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t3", "name": "Bash", "input": {"command": "pytest -q"}}]}},
    {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t3", "content": "48 passed"}]}},
]) + "\n")
hook(hook_event_name="UserPromptSubmit", session_id="ci-finished", prompt="Refactor billing and add refund tests")
hook(hook_event_name="Stop", session_id="ci-finished", prompt_id="p1", transcript_path=str(log),
     last_assistant_message="Updated `billing.py` and added 12 tests. All checks pass.")

workspace = launch("--workspace")
shot("workspace.png", workspace)
# A new state while the app runs must be picked up from the watched folder.
hook(hook_event_name="Notification", notification_type="permission_prompt",
     message="Claude needs your permission to use Bash")
time.sleep(3)
shot("workspace-needs-you.png", workspace)
if workspace.poll() is not None:
    raise SystemExit("Shishi exited while receiving an agent update.")
stop(workspace)

today = launch("--compact-workspace")
shot("today.png", today)
# The whole screen, to show the card sitting in its corner.
subprocess.run(["screencapture", "-x", str(shots / "desktop.png")], check=False, timeout=30)
stop(today)

# Once the waiting session ends, the finished one's report, built from its session log, comes forward.
hook(hook_event_name="SessionEnd", reason="other")
report = launch("--compact-workspace")
shot("report.png", report)
stop(report)

inbox = launch("--workspace", "--open-inbox")
shot("inbox.png", inbox)
stop(inbox)

dark = launch("--workspace", "--appearance", "dark")
shot("workspace-dark.png", dark)
stop(dark)

status = subprocess.run([str(python), "-B", str(resources / "ClaudeCode/install.py"), "install", "--json",
                         "--claude-home", str(shots.parent / "claude-home")], capture_output=True, text=True, timeout=60)
print(status.stdout.strip())
if not json.loads(status.stdout).get("working"):
    raise SystemExit("The bundled Claude Code installer did not produce a working hook.")
print("Launch check passed.")
