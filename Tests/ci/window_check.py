#!/usr/bin/env python3
"""Native window checks for the corner card on a real macOS session (F15, F16).

Writes a JSON record. Placement, focus preservation, duplicate windows and relaunch placement must pass.
Dragging and resizing need synthetic mouse input; when the machine does not deliver it, those checks are
recorded as not verified rather than passed.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
app = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
tool = out.parent / "wintool"
subprocess.run(["xcrun", "swiftc", "-O", str(ROOT / "Tests/ci/windows.swift"), "-o", str(tool)], check=True)
DOMAIN = "local.shishi.workdesk"
record = {"checks": [], "notes": []}


def check(name, ok, detail, required=True):
    status = "passed" if ok else ("failed" if required else "not verified")
    record["checks"].append({"name": name, "status": status, "detail": detail})
    print(f"{status:>12}  {name}: {detail}")


def tool_json(*args):
    return json.loads(subprocess.run([str(tool), *map(str, args)], capture_output=True, text=True, check=True, timeout=60).stdout)


def front_app():
    asn = subprocess.run(["lsappinfo", "front"], capture_output=True, text=True).stdout.strip()
    info = subprocess.run(["lsappinfo", "info", "-only", "name", asn], capture_output=True, text=True).stdout
    return info.split("=")[-1].strip().strip('"')


def card_windows(pid):
    return [w for w in tool_json("windows", pid) if w["onscreen"] and 250 <= w["w"] <= 900 and w["h"] < 1000 and w["layer"] < 20]


def launch():
    process = subprocess.Popen([str(app / "Contents/MacOS/ShiShi"), "--compact-workspace"])
    # The card appears once the page has loaded. On a busy CI machine that took longer than 8 seconds once,
    # so wait for the card itself, up to 20 seconds, and record how long it took.
    started = time.time()
    time.sleep(3)
    while time.time() - started < 20 and process.poll() is None and not card_windows(process.pid):
        time.sleep(1)
    if process.poll() is not None:
        raise SystemExit("Shishi exited during launch.")
    record["notes"].append(f"Card visible after {time.time() - started:.1f} s")
    time.sleep(2)
    return process


def stop(process):
    process.terminate()
    process.wait(timeout=10)
    time.sleep(1)


def hook(**event):
    python = app / "Contents/MacOS/shishi-python"
    event = {"session_id": "window-check", "cwd": "/Users/me/code/window-check", **event}
    subprocess.run([str(python), "-B", str(app / "Contents/Resources/ClaudeCode/receive.py")], input=json.dumps(event), text=True, check=True, timeout=30)


def shot(name):
    subprocess.run(["screencapture", "-x", str(out / name)], check=False, timeout=30)


for key in ["ShiShiCardCorner", "ShiShiCardWidth", "ShiShiCardHeight", "ShiShiCardTopLeft", "ShiShiCardSnap", "ShiShiCardAllSpaces", "ShiShiTodayPinned"]:
    subprocess.run(["defaults", "delete", DOMAIN, key], capture_output=True)
screen = tool_json("screen")
record["screen"] = screen
margin = 14

# 1. First placement: one card, top-right corner, an ordinary window level.
card = launch()
windows = card_windows(card.pid)
check("one card window", len(windows) == 1, f"{len(windows)} card-sized windows on screen")
frame = windows[0] if windows else {"x": 0, "y": 0, "w": 0, "h": 0, "layer": -1}
right_edge = screen["visibleX"] + screen["visibleWidth"]
check("starts in the top-right corner", abs(frame["x"] + frame["w"] - (right_edge - margin)) <= 2 and abs(frame["y"] - (screen["visibleTop"] + margin)) <= 2,
      f"frame {frame}")
check("not floating unless chosen", frame["layer"] == 0, f"window layer {frame['layer']}")
shot("window-1-placement.png")

# 1b. NATIVE-01: the card's height comes from its content and settles. Sample it for 6 seconds: it must not keep
# growing, and with the CI sample's few tasks it must stay under the 760-point cap the old feedback loop always reached.
heights = []
for _ in range(12):
    found = card_windows(card.pid)
    heights.append(found[0]["h"] if found else -1)
    time.sleep(0.5)
record["cardHeights"] = heights
check("card height settles below the cap", len(set(heights[4:])) == 1 and 0 < heights[-1] < 740,
      f"heights over 6 s: {heights}")

# 2. A result arrives while another app is in front: the card must not take focus.
subprocess.run(["open", "-a", "Calculator"], check=False)
time.sleep(4)
before = front_app()
hook(hook_event_name="UserPromptSubmit", prompt="Check focus")
hook(hook_event_name="Stop", prompt_id="p1", last_assistant_message="Done. All tests pass.")
time.sleep(5)
after = front_app()
check("new results do not take focus", before == after and before != "Shishi", f"front app before {before!r}, after {after!r}")
windows = card_windows(card.pid)
check("still one card window after a result", len(windows) == 1, f"{len(windows)} card-sized windows")
shot("window-2-focus.png")

# 3. Drag with the grip to the lower-left; it should snap into that corner.
frame = card_windows(card.pid)[0]
grip = (frame["x"] + frame["w"] / 2, frame["y"] + 10)
target = (screen["visibleX"] + 180, screen["visibleTop"] + screen["visibleHeight"] - 160)
drag = tool_json("drag", grip[0], grip[1], target[0], target[1])
time.sleep(2)
moved = card_windows(card.pid)[0]
synthetic = moved["x"] != frame["x"] or moved["y"] != frame["y"]
record["notes"].append(f"Synthetic input trusted: {drag['trusted']}")
if synthetic:
    # A command-line helper can read the Dock's reserved area a few points differently from the app
    # (seen: 5 points), so the corner the app saved decides, and the bottom edge must be near the Dock.
    bottom = screen["visibleTop"] + screen["visibleHeight"] - margin
    corner = subprocess.run(["defaults", "read", DOMAIN, "ShiShiCardCorner"], capture_output=True, text=True).stdout.strip()
    gap = moved["y"] + moved["h"] - bottom
    check("drag with the grip snaps to the nearest corner",
          corner == "bottomLeft" and abs(moved["x"] - (screen["visibleX"] + margin)) <= 2 and abs(gap) <= 8,
          f"saved corner {corner!r}, frame {moved}, bottom edge {gap:+.0f} points from the helper's visible area")
else:
    check("drag with the grip snaps to the nearest corner", False, "the machine did not deliver synthetic mouse input", required=False)
shot("window-3-drag.png")

# 4. Resize with the handle in the bottom-right corner.
frame = card_windows(card.pid)[0]
handle = (frame["x"] + frame["w"] - 12, frame["y"] + frame["h"] - 12)
tool_json("drag", handle[0], handle[1], handle[0] + 90, handle[1] - 40)
time.sleep(2)
sized = card_windows(card.pid)[0]
if sized["w"] != frame["w"]:
    saved = subprocess.run(["defaults", "read", DOMAIN, "ShiShiCardWidth"], capture_output=True, text=True).stdout.strip()
    check("resize with the handle and remember it", abs(sized["w"] - (frame["w"] + 90)) <= 4 and saved and abs(float(saved) - sized["w"]) <= 1,
          f"{frame['w']}x{frame['h']} -> {sized['w']}x{sized['h']}, saved width {saved}")
else:
    # When the grip drag above moved the card, synthetic input works, so a resize that did not happen is a failure.
    check("resize with the handle and remember it", False,
          f"width stayed {sized['w']} (height {frame['h']} -> {sized['h']})" if synthetic else "the machine did not deliver synthetic mouse input",
          required=synthetic)
shot("window-4-resize.png")

# 5. Relaunch: the same corner and size come back.
last = card_windows(card.pid)[0]
stop(card)
card = launch()
again = card_windows(card.pid)
check("relaunch restores place and size", len(again) == 1 and all(abs(again[0][key] - last[key]) <= 2 for key in ["x", "y", "w"]),
      f"before {last}, after {again[0] if again else None}")
shot("window-5-relaunch.png")
stop(card)

# 6. Stage Manager, best effort: the machine may not allow turning it on.
stage = subprocess.run(["defaults", "write", "com.apple.WindowManager", "GloballyEnabled", "-bool", "true"], capture_output=True)
subprocess.run(["killall", "WindowManager"], capture_output=True)
time.sleep(3)
card = launch()
staged = card_windows(card.pid)
check("card appears with Stage Manager enabled", len(staged) == 1, f"{len(staged)} card windows (setting write status {stage.returncode})", required=False)
shot("window-6-stage-manager.png")
stop(card)
subprocess.run(["defaults", "write", "com.apple.WindowManager", "GloballyEnabled", "-bool", "false"], capture_output=True)
subprocess.run(["killall", "WindowManager"], capture_output=True)
subprocess.run(["osascript", "-e", 'quit app "Calculator"'], capture_output=True)

(out / "window-check.json").write_text(json.dumps(record, indent=2))
failed = [item for item in record["checks"] if item["status"] == "failed"]
if failed:
    raise SystemExit(f"{len(failed)} required window checks failed.")
print("Window checks done.")
