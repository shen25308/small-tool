#!/usr/bin/env python3
"""Existing user data survives the upgrade: seed data in the 1.6 formats, run this build, and compare.

Runs on a macOS build machine against ~/Library/Application Support/ShiShiDesk. Anything already there is
moved aside first and put back at the end. Writes data-survival.json next to the screenshots.

1.6 formats: tasks without plannedDates or connection colours, a CodexInbox.json whose notices have no
"archived" key, result receipts from shishi-send.py with a .read marker, and connector preferences in defaults.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
app = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
binary = app / "Contents/MacOS/ShiShi"
python = app / "Contents/MacOS/shishi-python"
resources = app / "Contents/Resources"
support = Path.home() / "Library/Application Support/ShiShiDesk"
aside = support.with_name("ShiShiDesk.before-survival-check")
DOMAIN = "local.shishi.workdesk"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_data():
    result = subprocess.run([str(binary), "--check-data"], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise SystemExit("--check-data reported a problem:\n" + result.stdout + result.stderr)
    return json.loads(result.stdout)


def defaults(key):
    result = subprocess.run(["defaults", "read", DOMAIN, key], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


if aside.exists():
    shutil.rmtree(aside)
if support.exists():
    support.rename(aside)
problems, record = [], {"app": str(app)}
try:
    support.mkdir(parents=True)
    # Tasks as 1.6 saved them: the CI sample, with no 1.7 fields.
    import datetime, re
    today = datetime.date.today()
    text = (ROOT / "Tests/ci/sample-workspace.json").read_text()
    text = re.sub(r'"@(-?\d+)', lambda m: '"' + (today + datetime.timedelta(days=int(m.group(1)))).isoformat(), text)
    old = json.loads(text)
    for task in old["tasks"]:
        for key in ("plannedDates", "next", "nextSignature", "previous", "series"):
            task.pop(key, None)
    old.pop("sourceColors", None)
    (support / "Workspace.json").write_text(json.dumps(old, ensure_ascii=False, sort_keys=True))
    original_bytes = (support / "Workspace.json").read_bytes()
    # A Codex inbox as 1.6 wrote it: no "archived" key.
    now = time.time()
    codex = {"since": now - 86400, "cursors": {}, "notices": [
        {"id": "thread-a/turn-1", "thread": "11111111-1111-4111-8111-111111111111", "title": "Codex · api-server",
         "summary": "Fixed the pagination bug.\n\nTests: 48 passed.", "time": now - 3600, "read": False},
        {"id": "thread-b/turn-4", "thread": "22222222-2222-4222-8222-222222222222", "title": "Codex · 网站",
         "summary": "已经修改了首页，测试全部通过。", "time": now - 7200, "read": True}]}
    (support / "CodexInbox.json").write_text(json.dumps(codex, ensure_ascii=False))
    # Results delivered by the 1.6 sender, one of them already read.
    for index, (source, title, body) in enumerate([
            ("Claude Code", "Claude Code · small-tool", "Updated billing.py. All checks pass."),
            ("Local AI", "Nightly summary", "Three reports were generated."),
            ("Claude Code", "Claude Code · 文档", "需要你确认后才能继续。")]):
        subprocess.run([str(python), "-B", str(resources / "Connectors/shishi-send.py"), "--source", source, "--title", title,
                        "--event-id", f"survival-{index}"], input=body, text=True, check=True, timeout=30)
    receipts = sorted((support / "Incoming").glob("*.json"))
    receipts[0].with_suffix(".read").write_text("")
    subprocess.run(["defaults", "write", DOMAIN, "ShiShiCodexEnabled", "-bool", "true"], check=False)
    subprocess.run(["defaults", "write", DOMAIN, "ShiShiShowsResults", "-bool", "false"], check=False)
    before_files = {path.name: sha(path) for path in (support / "Incoming").iterdir()}
    before_defaults = {key: defaults(key) for key in ("ShiShiCodexEnabled", "ShiShiShowsResults")}
    before = check_data()
    record["before"] = before
    if before["workspace"]["tasks"] != len(old["tasks"]):
        problems.append("The 1.6 workspace did not load completely.")
    if before["codex"]["notices"] != 2 or before["results"]["notices"] != 3 or before["results"]["unread"] != 2:
        problems.append("The 1.6 inbox did not load completely: " + json.dumps(before))

    # Run this build as a user would: open it, receive one new result, quit.
    process = subprocess.Popen([str(binary), "--workspace"])
    time.sleep(8)
    subprocess.run([str(python), "-B", str(resources / "Connectors/shishi-send.py"), "--source", "Claude Code",
                    "--title", "Claude Code · new", "--event-id", "survival-new"], input="A new result after the upgrade.",
                   text=True, check=True, timeout=30)
    time.sleep(4)
    if process.poll() is not None:
        problems.append(f"Shishi exited with status {process.returncode} while running on 1.6 data.")
    process.terminate()
    process.wait(timeout=15)

    after = check_data()
    record["after"] = after
    new = json.loads((support / "Workspace.json").read_text())
    by_id = {task["id"]: task for task in new["tasks"]}
    # 1.8 moves lists to stable IDs: the names, their order and every task's list must be the same.
    lists = new.get("lists") or {}
    name = lambda list_id: (lists.get(list_id) or {}).get("name", list_id)
    for task in old["tasks"]:
        kept = by_id.get(task["id"])
        if kept is None:
            problems.append("Task lost: " + task["title"])
            continue
        changed = [key for key, value in task.items() if (name(kept.get(key)) if key == "project" else kept.get(key)) != value]
        if changed:
            problems.append(f"Task changed without an edit: {task['title']} ({', '.join(changed)})")
    if [name(list_id) for list_id in new["projects"]] != old["projects"]:
        problems.append("The list names changed.")
    if new.get("schema") != 2:
        problems.append("The lists were not upgraded to stable IDs.")
    copies = sorted((support / "Backups").glob("Workspace before upgrade *.json"))
    record["upgradeCopy"] = copies[-1].name if copies else ""
    if not copies or copies[-1].read_bytes() != original_bytes:
        problems.append("No exact copy of the 1.7 workspace was kept before the upgrade.")
    if not set(before["codex"]["ids"]) <= set(after["codex"]["ids"]):
        problems.append("A Codex result was lost.")
    stored = {notice["id"]: notice for notice in json.loads((support / "CodexInbox.json").read_text())["notices"]}
    for notice in codex["notices"]:
        kept = stored.get(notice["id"], {})
        if kept.get("summary") != notice["summary"] or kept.get("read") != notice["read"]:
            problems.append("A Codex reply or its read state changed: " + notice["id"])
    if not set(before["results"]["ids"]) <= set(after["results"]["ids"]) or after["results"]["notices"] != 4:
        problems.append("Results were lost or the new one did not arrive: " + json.dumps(after["results"]))
    for name, digest in before_files.items():
        path = support / "Incoming" / name
        if not path.exists() or sha(path) != digest:
            problems.append("An original reply file was changed or removed: " + name)
    after_defaults = {key: defaults(key) for key in before_defaults}
    if after_defaults != before_defaults:
        problems.append(f"Connector preferences changed: {before_defaults} -> {after_defaults}")
    record.update(problems=problems, passed=not problems,
                  checked=["tasks and lists, field by field", "Codex replies and read state", "original reply files, byte for byte",
                           "read markers", "connector preferences", "a new result arriving after the upgrade"])
finally:
    (out / "data-survival.json").write_text(json.dumps(record, indent=2, ensure_ascii=False))
    shutil.rmtree(support, ignore_errors=True)
    if aside.exists():
        aside.rename(support)
print(json.dumps({key: record.get(key) for key in ("passed", "problems")}, indent=2))
if problems:
    raise SystemExit("Existing data did not survive: " + "; ".join(problems))
print("Data survival check passed.")
