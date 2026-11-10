#!/usr/bin/env python3
"""Install a standalone personal Grok Build hook with no changes to shared config."""
import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNTIME_NAME = ".shishi-inbox-runtime"
HOOK_NAME = "shishi-inbox.json"


def atomic_write(path, contents):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as fp:
        temporary = Path(fp.name)
        try:
            fp.write(contents)
            fp.flush()
            os.fsync(fp.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def definition(python, receiver):
    handler = {"type": "command", "command": python, "args": [str(receiver)], "timeout": 8}
    return {"hooks": {"Stop": [{"hooks": [handler]}]}}


def owned_definition(config, root):
    try:
        handler = config["hooks"]["Stop"][0]["hooks"][0]
        receiver = Path(handler["args"][0])
        return (receiver.name == "receive.py" and receiver.parent.parent == root
                and re.fullmatch(r"[0-9a-f]{64}", receiver.parent.name)
                and config == definition(handler["command"], receiver))
    except (KeyError, IndexError, TypeError, ValueError):
        return False


def install(action, grok_home, sender):
    folder = grok_home / "hooks"
    config = folder / HOOK_NAME
    runtime = folder / RUNTIME_NAME
    if action == "status":
        print("Grok Build CLI: " + (shutil.which("grok") or "not found on PATH"))
        if config.is_file() and not config.is_symlink():
            installed = owned_definition(json.loads(config.read_text()), runtime)
            print("Shishi Stop hook: " + ("configured" if installed else "the hook filename is in use by another configuration"))
        else:
            print("Shishi Stop hook: not configured")
        return
    if not folder.exists() and action == "remove":
        print("No Shishi Stop hook is installed.")
        return
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Serialise concurrent installations/removals without writing a lock file in the hook list.
    descriptor = os.open(folder, os.O_RDONLY)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        if config.is_symlink() or runtime.is_symlink():
            raise ValueError("The connector path is a symbolic link. Choose a different local installation directory.")
        if config.exists() and not owned_definition(json.loads(config.read_text()), runtime):
            raise ValueError("The hook filename is already in use. Rename the existing file before installing.")
        if action == "remove":
            config.unlink(missing_ok=True)
            print("The Shishi Stop hook is disabled.")
            return
        files = {"receive.py": (HERE / "receive.py").read_bytes(), "shishi-send.py": sender.read_bytes()}
        digest = hashlib.sha256(files["receive.py"] + b"\x00" + files["shishi-send.py"]).hexdigest()
        generation = runtime / digest
        if generation.is_symlink():
            raise ValueError("The connector version directory is a symbolic link.")
        generation.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name, content in files.items():
            dest = generation / name
            if dest.is_symlink() or (dest.exists() and dest.read_bytes() != content):
                raise ValueError("The installed connector files do not match this version.")
            if not dest.exists():
                atomic_write(dest, content)
        new_config = definition(sys.executable, generation / "receive.py")
        atomic_write(config, (json.dumps(new_config, ensure_ascii=False, indent=2) + "\n").encode())
        print(f"Installed the Shishi Stop hook at {config}. Restart Grok Build and check /hooks.")
        if not shutil.which("grok"):
            print("Grok Build is not on PATH. Install the CLI to deliver replies through this hook.")
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "status", "remove"])
    parser.add_argument("--grok-home", type=Path, default=Path(os.environ.get("GROK_HOME") or Path.home()/".grok"))
    parser.add_argument("--sender", type=Path, default=HERE.parent/"Connectors"/"shishi-send.py")
    options = parser.parse_args()
    try:
        install(options.action, options.grok_home.expanduser().resolve(), options.sender.expanduser().resolve())
    except (OSError, ValueError) as err:
        parser.exit(1, f"Shishi connector: {err}\n")
