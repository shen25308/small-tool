#!/usr/bin/env python3
"""Publish a coding agent's live state to the Agents strip in Shishi.

Each session owns one small JSON file. Shishi reads the folder; nothing here opens a network
connection. Import `write`, `read` and `clear`, or call the command line:

    shishi_agents.py set --source "My tool" --session run-42 --state working --title "Nightly build"
    shishi_agents.py clear --source "My tool" --session run-42
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import unicodedata

STATES = ("working", "done", "attention", "idle")
DEFAULT_DIRECTORY = Path.home() / "Library/Application Support/ShiShiDesk/Agents"
LIMITS = {"source": 100, "session": 512, "title": 200, "detail": 400}


def directory():
    return Path(os.environ.get("SHISHI_AGENTS_DIR") or DEFAULT_DIRECTORY)


def clean(value, field, required=True):
    """One printable line that fits the field. Agents often pass whole prompts or replies."""
    text = unicodedata.normalize("NFC", str(value or ""))
    text = "".join(" " if unicodedata.category(char) in ("Cc", "Cf", "Zl", "Zp") else char for char in text)
    text = " ".join(text.split())
    limit = LIMITS[field]
    if len(text) > limit:
        text = text[:limit - 1].rstrip() + "…"
    if required and not text:
        raise ValueError(f"{field} is required.")
    return text


def key(source, session):
    return hashlib.sha256((source + "\0" + session).encode("utf-8")).hexdigest()


def path_for(source, session):
    return directory() / (key(clean(source, "source"), clean(session, "session")) + ".json")


def read(source, session):
    try:
        value = json.loads(path_for(source, session).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def write(source, session, state, title, detail="", extra=None):
    if state not in STATES:
        raise ValueError("state must be one of: " + ", ".join(STATES))
    source, session = clean(source, "source"), clean(session, "session")
    record = dict(extra or {})
    record.update(version=1, source=source, session=session, state=state,
                  title=clean(title, "title"), detail=clean(detail, "detail", required=False),
                  time=time.time())
    folder = directory()
    folder.mkdir(parents=True, mode=0o700, exist_ok=True)
    final = folder / (key(source, session) + ".json")
    # Replace the file in one step so Shishi never reads a half-written state.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=folder, prefix=".pending-", delete=False) as stream:
        pending = Path(stream.name)
        try:
            json.dump(record, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.replace(pending, final)
        finally:
            pending.unlink(missing_ok=True)
    return record


def clear(source, session):
    path_for(source, session).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("set", "clear"):
        command = commands.add_parser(name)
        command.add_argument("--source", required=True, help="Tool name shown in Shishi, e.g. Codex")
        command.add_argument("--session", required=True, help="Stable ID for this run or conversation")
        if name == "set":
            command.add_argument("--state", required=True, choices=STATES)
            command.add_argument("--title", required=True)
            command.add_argument("--detail", default="")
    options = parser.parse_args()
    try:
        if options.action == "set":
            write(options.source, options.session, options.state, options.title, options.detail)
        else:
            clear(options.source, options.session)
    except (OSError, ValueError) as problem:
        parser.exit(1, f"Shishi could not update the agent status: {problem}\n")


if __name__ == "__main__":
    main()
