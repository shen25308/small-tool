#!/usr/bin/env python3
"""Add or remove Shishi's hooks in your personal Claude Code settings.

Only Shishi's own handlers are touched. Every other setting and hook is kept as it is, and the
first change saves a copy of the previous file next to it.
"""
import argparse
import fcntl
import hashlib
import json
import os
import shlex
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNTIME_NAME = "shishi-inbox-runtime"
BACKUP_NAME = "settings.json.before-shishi"
# Notification is limited to the cases where Claude is waiting for the user.
EVENTS = {
    "UserPromptSubmit": None,
    "Stop": None,
    "Notification": "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input",
    "PostToolUse": None,
    "SessionEnd": None,
}
# Optional, and the only handler that makes Claude wait: it gives Shishi's card a short time to answer a
# permission request before Claude Code asks in the terminal.
APPROVALS = "PermissionRequest"
APPROVAL_TIMEOUT = 130


def atomic_write(path, contents):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".shishi-", delete=False) as stream:
        pending = Path(stream.name)
        try:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(pending, path)
        finally:
            pending.unlink(missing_ok=True)


def is_ours(handler):
    return (isinstance(handler, dict) and handler.get("type") == "command"
            and isinstance(handler.get("command"), str) and "/" + RUNTIME_NAME + "/" in handler["command"])


def without_ours(settings):
    """Remove Shishi's handlers and return how many events had one."""
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return 0
    found = 0
    for event in list(hooks):
        groups = hooks[event]
        if not isinstance(groups, list):
            continue
        kept, touched = [], False
        for group in groups:
            handlers = group.get("hooks") if isinstance(group, dict) else None
            if not isinstance(handlers, list) or not any(is_ours(item) for item in handlers):
                kept.append(group)
                continue
            touched = True
            rest = [item for item in handlers if not is_ours(item)]
            if rest:
                kept.append({**group, "hooks": rest})
        if touched:
            found += 1
            if kept:
                hooks[event] = kept
            else:
                del hooks[event]
    if not hooks:
        del settings["hooks"]
    return found


def installed_command(settings):
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return "", []
    command, events = "", []
    for event, groups in hooks.items():
        for group in groups if isinstance(groups, list) else []:
            for handler in (group.get("hooks") or []) if isinstance(group, dict) else []:
                if is_ours(handler):
                    if event != APPROVALS:
                        command = handler["command"]
                    events.append(event)
    return command, sorted(set(events))


def load(path):
    if not path.exists():
        return {}
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        raise ValueError("Claude Code settings.json is not valid JSON. Fix it before connecting Shishi.") from None
    if not isinstance(settings, dict):
        raise ValueError("Claude Code settings.json has an unexpected format.")
    return settings


def status(home, settings_path):
    command, events = installed_command(load(settings_path))
    parts = shlex.split(command) if command else []
    runtime_ok = bool(parts) and all(Path(part).exists() for part in parts if part.startswith("/"))
    complete = bool(command) and set(events) - {APPROVALS} == set(EVENTS)
    return {
        "ok": True, "installed": bool(command), "working": complete and runtime_ok,
        "events": [event for event in events if event != APPROVALS], "approvals": APPROVALS in events,
        "cli": bool(shutil.which("claude")),
        "problem": "" if not command or (complete and runtime_ok)
        else "The connection is out of date. Connect again to repair it.",
    }


def install(action, home, sources, approvals=False):
    settings_path = home / "settings.json"
    if action == "status":
        return status(home, settings_path)
    if action == "remove" and not settings_path.exists():
        return {"ok": True, "installed": False, "working": False, "events": [], "cli": bool(shutil.which("claude")), "problem": ""}
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Write through a dotfiles symlink so the user's link survives.
    target = settings_path.resolve()
    descriptor = os.open(home, os.O_RDONLY)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        settings = load(target)
        original = target.read_bytes() if target.exists() else None
        without_ours(settings)
        if action == "install":
            files = {path.name: path.read_bytes() for path in sources}
            digest = hashlib.sha256(b"\x00".join(files[name] for name in sorted(files))).hexdigest()
            runtime = home / RUNTIME_NAME
            generation = runtime / digest
            if runtime.is_symlink() or generation.is_symlink():
                raise ValueError("The connector folder is a symbolic link. Remove it and connect again.")
            generation.mkdir(mode=0o700, parents=True, exist_ok=True)
            for name, content in files.items():
                destination = generation / name
                if destination.is_symlink():
                    raise ValueError("The installed connector files are symbolic links.")
                if not destination.exists() or destination.read_bytes() != content:
                    atomic_write(destination, content)
            command = shlex.quote(sys.executable) + " -B " + shlex.quote(str(generation / "receive.py"))
            hooks = settings.setdefault("hooks", {})
            if not isinstance(hooks, dict):
                raise ValueError("The hooks section of settings.json has an unexpected format.")
            for event, matcher in EVENTS.items():
                # Background hooks never delay Claude, even when Shishi is closed.
                handler = {"type": "command", "command": command, "timeout": 10, "async": True}
                group = {"hooks": [handler]}
                if matcher:
                    group = {"matcher": matcher, "hooks": [handler]}
                groups = hooks.setdefault(event, [])
                if not isinstance(groups, list):
                    raise ValueError(f"The {event} hooks in settings.json have an unexpected format.")
                groups.append(group)
            if approvals:
                approve = shlex.quote(sys.executable) + " -B " + shlex.quote(str(generation / "permission.py"))
                groups = hooks.setdefault(APPROVALS, [])
                if not isinstance(groups, list):
                    raise ValueError(f"The {APPROVALS} hooks in settings.json have an unexpected format.")
                # Not async: Claude Code waits for the answer. The hook gives up well before this timeout.
                groups.append({"hooks": [{"type": "command", "command": approve, "timeout": APPROVAL_TIMEOUT}]})
        updated = (json.dumps(settings, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if updated != original:
            backup = target.with_name(BACKUP_NAME)
            if original is not None and not backup.exists():
                atomic_write(backup, original)
            atomic_write(target, updated)
    finally:
        os.close(descriptor)
    return status(home, settings_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "status", "remove"])
    parser.add_argument("--claude-home", type=Path,
                        default=Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude"))
    parser.add_argument("--connectors", type=Path, default=HERE.parent / "Connectors",
                        help="Folder that holds shishi-send.py and shishi_agents.py")
    parser.add_argument("--json", action="store_true", help="Print one JSON object for Shishi")
    parser.add_argument("--approvals", action="store_true",
                        help="Also let Shishi's card answer permission requests (Claude waits briefly for it)")
    options = parser.parse_args()
    sources = [HERE / "receive.py", HERE / "permission.py", options.connectors / "shishi-send.py", options.connectors / "shishi_agents.py"]
    try:
        result = install(options.action, options.claude_home.expanduser(), sources, approvals=options.approvals)
    except (OSError, ValueError) as problem:
        if options.json:
            print(json.dumps({"ok": False, "error": str(problem)}))
            return 1
        parser.exit(1, f"Shishi connector: {problem}\n")
    if options.json:
        print(json.dumps(result))
        return 0
    if not result["installed"]:
        print("Shishi hooks: not connected")
    elif result["working"]:
        print("Shishi hooks: connected (" + ", ".join(result["events"]) + ")")
    else:
        print("Shishi hooks: " + result["problem"])
    print("Claude Code CLI: " + ("found" if result["cli"] else "not found on PATH"))
    if options.action == "install":
        print("Claude Code picks up the change automatically. Finish a turn to see it in Shishi.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
