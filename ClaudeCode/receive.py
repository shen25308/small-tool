#!/usr/bin/env python3
"""Turn Claude Code hook events into a live status and a quiet Shishi receipt.

Claude Code passes one JSON event on standard input. This script never asks Claude to continue:
it exits 0 on success and 1 on a delivery problem, and it prints nothing to standard output.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Installed copies sit in one folder. In the app bundle and the repository they are siblings.
SHARED = HERE if (HERE / "shishi_agents.py").is_file() else HERE.parent / "Connectors"
sys.path.insert(0, str(SHARED))
import shishi_agents as agents  # noqa: E402

SOURCE = "Claude Code"
MAX_SUMMARY_BYTES = 60 * 1024
# Terminals that set TERM_PROGRAM but whose sessions may not carry a bundle identifier.
TERMINALS = {"Apple_Terminal": "com.apple.Terminal", "iTerm.app": "com.googlecode.iterm2", "vscode": "com.microsoft.VSCode",
             "WarpTerminal": "dev.warp.Warp-Stable", "ghostty": "com.mitchellh.ghostty"}
NEEDS_USER = {"permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"}


def text(value):
    return value if isinstance(value, str) else ""


def host_app():
    """The app this Claude Code session runs in, so Shishi can bring it forward. Only its bundle ID is kept."""
    bundle = os.environ.get("__CFBundleIdentifier", "")
    if len(bundle) <= 120 and re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", bundle):
        return bundle
    return TERMINALS.get(os.environ.get("TERM_PROGRAM", ""), "")


SHELLS = {"sh", "bash", "zsh", "dash", "fish", "env"}


def agent_pid():
    """The Claude Code process that ran this hook, so Shishi can tell when a session dies without saying so.

    The hook may run under a shell, so walk up a few parents and skip shells."""
    pid = os.getppid()
    for _ in range(4):
        if pid <= 1:
            return 0
        try:
            out = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)], capture_output=True, text=True, timeout=2).stdout.split(None, 1)
        except (OSError, subprocess.TimeoutExpired):
            return 0
        if len(out) != 2:
            return 0
        if Path(out[1].strip()).name not in SHELLS:
            return pid
        pid = int(out[0])
    return 0


def terminal_place(pid):
    """Where this session runs, so Shishi can bring forward the exact tab: an iTerm2 session, a Terminal tab
    (by its tty) or a tmux pane. Only identifiers are kept, never screen contents."""
    place = {}
    iterm = os.environ.get("ITERM_SESSION_ID", "")
    match = re.fullmatch(r"w\d+t\d+p\d+:([0-9A-Fa-f-]{36})", iterm)
    if match:
        place["iterm"] = match.group(1).upper()
    pane, server = os.environ.get("TMUX_PANE", ""), os.environ.get("TMUX", "").split(",")[0]
    if re.fullmatch(r"%\d{1,6}", pane) and server.startswith("/") and len(server) < 300:
        place["tmuxPane"], place["tmuxSocket"] = pane, server
    if pid:
        try:
            tty = subprocess.run(["ps", "-o", "tty=", "-p", str(pid)], capture_output=True, text=True, timeout=2).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            tty = ""
        if re.fullmatch(r"ttys\d{3,4}", tty):
            place["tty"] = tty
    return place


def activity(event):
    """A short, local description of the tool that just ran, such as "Edit billing.py" or "Bash: pytest -q"."""
    tool = text(event.get("tool_name"))[:40]
    data = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    target = text(data.get("file_path")) or text(data.get("notebook_path")) or text(data.get("path"))
    if target:
        return tool + " " + Path(target).name[:80]
    if tool == "Bash":
        command = " ".join(text(data.get("command")).split())
        return "Bash: " + (command[:77] + "…" if len(command) > 78 else command)
    if tool in ("Task", "Agent"):
        return "Subagent: " + " ".join(text(data.get("description")).split())[:70]
    for field in ("pattern", "query", "url"):
        if text(data.get(field)):
            return tool + " " + " ".join(text(data[field]).split())[:70]
    return tool


LOG_LINES = 200


def log_delivery(event, outcome):
    """Keep the last few hook deliveries for Shishi's Diagnostics. No prompt, reply or tool content is kept."""
    try:
        path = agents.directory().parent / "HookLog.jsonl"
        session = text(event.get("session_id")) if isinstance(event, dict) else ""
        row = {"time": round(time.time(), 3), "source": SOURCE,
               "event": text(event.get("hook_event_name"))[:40] if isinstance(event, dict) else "",
               "session": hashlib.sha256(session.encode("utf-8")).hexdigest()[:8] if session else "",
               "outcome": outcome[:160]}
        lines = path.read_text(encoding="utf-8").splitlines()[-(LOG_LINES - 1):] if path.is_file() else []
        lines.append(json.dumps(row, ensure_ascii=False))
        agents.directory().parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        pending = path.with_name(".HookLog.pending")
        pending.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.replace(pending, path)
    except OSError:
        pass


def withdraw_approvals(session):
    """A tool ran or the turn ended, so any request still waiting on Shishi's card was answered elsewhere."""
    base = agents.directory().parent / "Approvals"
    if not base.is_dir():
        return
    for path in base.glob("*.json"):
        try:
            if json.loads(path.read_text(encoding="utf-8")).get("session") == session:
                path.unlink(missing_ok=True)
        except (OSError, ValueError, AttributeError):
            continue


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


# Commands whose result says whether the work is sound: tests, builds, linters and type checks.
CHECKS = re.compile(r"\b(?:pytest|py\.test|unittest|tox|nox|jest|vitest|mocha|ava|playwright test|cypress run|node --test|"
                    r"(?:npm|pnpm|yarn|bun)(?: run)? (?:test|build|lint|check|typecheck|type-check)\b|npx (?:tsc|eslint|jest|vitest)|"
                    r"tsc\b|eslint\b|ruff\b|mypy\b|pyright\b|flake8\b|black --check|go (?:test|build|vet)|cargo (?:test|build|check|clippy)|"
                    r"swift (?:test|build)|xcodebuild\b|mvn\b|gradle\w* (?:test|build|check)|rspec\b|rake test|phpunit|mix test|"
                    r"dotnet (?:test|build)|ctest\b|make(?: \w+)?\b|bazel (?:test|build))")
EDITS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}


def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(text(part.get("text")) for part in content if isinstance(part, dict))
    return ""


def is_prompt(row):
    """A message the user typed, as opposed to tool results or text Claude Code adds by itself."""
    if row.get("type") != "user" or row.get("isSidechain") or row.get("isMeta"):
        return False
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return bool(content.strip()) and not content.lstrip().startswith("<")
    return isinstance(content, list) and any(isinstance(part, dict) and part.get("type") == "text" for part in content) \
        and not any(isinstance(part, dict) and part.get("type") == "tool_result" for part in content)


def turn_facts(transcript, cwd):
    """What the last turn actually did, read from Claude Code's own session log rather than from its reply."""
    path = Path(transcript)
    if not transcript or not path.is_file():
        return None
    with path.open("rb") as stream:
        stream.seek(max(0, path.stat().st_size - 4 * 1024 * 1024))
        rows = []
        for line in stream.read().splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and not row.get("isSidechain"):
                rows.append(row)
    start = max((i for i, row in enumerate(rows) if is_prompt(row)), default=-1)
    if start < 0:
        return None
    root = Path(cwd) if cwd else None
    files, calls, results = [], {}, {}
    for row in rows[start + 1:]:
        content = (row.get("message") or {}).get("content")
        for part in content if isinstance(content, list) else []:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "tool_use":
                name, args = text(part.get("name")), part.get("input") if isinstance(part.get("input"), dict) else {}
                calls[text(part.get("id"))] = (name, args)
                target = text(args.get("file_path")) or text(args.get("notebook_path"))
                if name in EDITS and target:
                    try:
                        shown = str(Path(target).relative_to(root)) if root else target
                    except ValueError:
                        shown = target
                    if shown not in files:
                        files.append(shown)
            elif part.get("type") == "tool_result":
                body = content_text(part.get("content"))
                failed = part.get("is_error") is True or bool(re.match(r"\s*Exit code [1-9]", body))
                results[text(part.get("tool_use_id"))] = failed
    # The last run of each check decides: a test that failed and then passed counts as passed.
    checks, failed_tools, commands = {}, 0, 0
    for key, (name, args) in calls.items():
        if key in results and results[key]:
            failed_tools += 1
        if name != "Bash":
            continue
        commands += 1
        command = " ".join(text(args.get("command")).split())
        if CHECKS.search(command) and key in results:
            checks[command] = results[key]
    failing = [command for command, failed in checks.items() if failed]
    shown_command = (failing or list(checks))[-1] if checks else ""
    return {
        "files": files[:12], "fileCount": len(files), "commands": commands, "failedTools": failed_tools,
        "tests": "failed" if failing else "passed" if checks else "none",
        "testCommand": shown_command[:120],
    }


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
    app = host_app() or text(previous.get("app"))
    if app:
        keep["app"] = app
    if isinstance(previous.get("started"), (int, float)):
        keep["started"] = previous["started"]
    # A resumed session runs in a new process, so each prompt looks again; other events only fill a gap.
    pid = agent_pid() if name == "UserPromptSubmit" or (name in ("Notification", "PostToolUse") and not previous.get("pid")) else 0
    if pid or isinstance(previous.get("pid"), int):
        keep["pid"] = pid or previous["pid"]
    # A session started from a Shishi task carries its ID, so the report and the time spent attach to the task.
    linked = os.environ.get("SHISHI_TASK", "")
    if re.fullmatch(r"[0-9A-Za-z-]{8,64}", linked):
        keep["shishiTask"] = linked
    elif isinstance(previous.get("shishiTask"), str):
        keep["shishiTask"] = previous["shishiTask"]
    cwd = text(event.get("cwd"))
    if cwd.startswith("/") and len(cwd) < 1024:
        keep["cwd"] = cwd
    if pid:
        keep["terminal"] = terminal_place(pid)
    elif isinstance(previous.get("terminal"), dict):
        keep["terminal"] = previous["terminal"]

    if name in ("PostToolUse", "Stop", "SessionEnd"):
        withdraw_approvals(session)
    if name == "UserPromptSubmit":
        prompt = agents.clean(event.get("prompt"), "detail", required=False)
        agents.write(SOURCE, session, "working", title, prompt, {**keep, "task": prompt, "started": time.time()})
    elif name == "PostToolUse":
        # A tool ran: the session is working (a pending permission request has been answered), and this is
        # what it is doing now. A late tool event never reopens a finished turn.
        if previous.get("state") == "done":
            return
        task = text(previous.get("task"))
        tools = previous.get("tools") if isinstance(previous.get("tools"), int) else 0
        agents.write(SOURCE, session, "working", title, task,
                     {**keep, "task": task, "activity": activity(event), "tools": tools + 1})
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
        task = text(previous.get("task"))
        extra = {**keep, "task": task, "receipt": "connector/" + receipt}
        try:
            facts = turn_facts(text(event.get("transcript_path")), text(event.get("cwd")))
        except (OSError, ValueError):
            facts = None
        if facts:
            extra["facts"] = facts
        agents.write(SOURCE, session, "done", title, summary, extra)
    elif name == "SessionEnd":
        # A finished result stays visible until it is read or dismissed in Shishi.
        if previous.get("state") != "done":
            agents.clear(SOURCE, session)


if __name__ == "__main__":
    event = None
    try:
        event = json.load(sys.stdin)
        receive(event)
        log_delivery(event, "delivered")
    except (OSError, ValueError, TypeError, AttributeError, RuntimeError, subprocess.TimeoutExpired) as problem:
        print(f"Shishi connector: {problem}", file=sys.stderr)
        log_delivery(event, "problem: " + str(problem))
        # Exit status 2 would ask Claude to keep working. A delivery problem must never do that.
        sys.exit(1)
