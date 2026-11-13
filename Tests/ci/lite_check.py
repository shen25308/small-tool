#!/usr/bin/env python3
"""Check the light build: no offline model, the engine kept for an optional download, a stamped commit, and it starts."""
import os
import plistlib
import subprocess
import sys
import time
from pathlib import Path

app = Path(sys.argv[1]).resolve()
contents = app / "Contents"
if (contents / "Resources/assistant.gguf").exists():
    raise SystemExit("The light build still contains the offline model.")
if not (contents / "Frameworks/Inference/llama-completion").exists():
    raise SystemExit("The light build lost the inference engine it needs to use a downloaded model.")
info = plistlib.loads((contents / "Info.plist").read_bytes())
expected = os.environ.get("GITHUB_SHA")
if info.get("ShishiVariant") != "light" or not info.get("ShishiSourceCommit"):
    raise SystemExit("The light build is not stamped with its variant and source commit.")
if expected and info["ShishiSourceCommit"] != expected:
    raise SystemExit(f"The light build says commit {info['ShishiSourceCommit']}, but this run built {expected}.")
print("Light build commit:", info["ShishiSourceCommit"], "version", info.get("CFBundleShortVersionString"))
size = sum(path.stat().st_size for path in app.rglob("*") if path.is_file() and not path.is_symlink())
print(f"Light app: {size / 1e6:.0f} MB")
if size > 250e6:
    raise SystemExit("The light build is larger than expected.")
for needed in ["Resources/ClaudeCode/receive.py", "Resources/ClaudeCode/install.py", "Resources/Connectors/shishi_agents.py",
               "Resources/UI/index.html", "MacOS/shishi-python"]:
    if not (contents / needed).exists():
        raise SystemExit("The light build is missing " + needed)
process = subprocess.Popen([str(contents / "MacOS/ShiShi"), "--workspace"])
time.sleep(8)
if process.poll() is not None:
    raise SystemExit(f"The light app exited during launch with status {process.returncode}.")
process.terminate()
process.wait(timeout=10)
print("Light launch check passed.")
