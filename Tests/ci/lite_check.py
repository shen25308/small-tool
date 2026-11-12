#!/usr/bin/env python3
"""Check the light build: no offline model, a much smaller bundle, and it starts and stays up."""
import subprocess
import sys
import time
from pathlib import Path

app = Path(sys.argv[1]).resolve()
contents = app / "Contents"
if (contents / "Resources/assistant.gguf").exists() or (contents / "Frameworks/Inference").exists():
    raise SystemExit("The light build still contains the offline model or its engine.")
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
