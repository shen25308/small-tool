"""Install an audited, relocatable arm64 CPython into a staged application bundle."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile

ARCHIVE_SHA256 = "332588681afefc98045995122657a64f8e708d0fb56e683733b1f7cc42157f97"
ARCHIVE_URL = "https://github.com/astral-sh/python-build-standalone/releases/download/20260929/cpython-3.12.14%2B20260929-aarch64-apple-darwin-pgo%2Blto-full.tar.zst"

def prepare(archive, contents):
    with archive.open("rb") as stream:
        digest=hashlib.sha256()
        for block in iter(lambda:stream.read(1024*1024),b""):digest.update(block)
    if digest.hexdigest()!=ARCHIVE_SHA256:
        raise SystemExit("Python runtime archive checksum mismatch")
    stdlib=contents/"Resources/Python/lib/python3.12"
    helpers=contents/"Helpers"
    legal=contents/"Resources/Licenses/PythonRuntime"
    with tempfile.TemporaryDirectory() as scratch:
        subprocess.run(["/usr/bin/tar","-xf",str(archive.resolve()),"-C",scratch,"python/install/bin/python3.12","python/install/lib/python3.12","python/licenses"],check=True)
        upstream=Path(scratch)/"python"
        helpers.mkdir(parents=True,exist_ok=True)
        shutil.copy2(upstream/"install/bin/python3.12",helpers/"python3.12")
        # Extension modules used for TLS, JSON and SQLite are built into this executable.
        skip=shutil.ignore_patterns("__pycache__","*.pyc","site-packages","ensurepip","lib-dynload","config-3.12*","test","tkinter","idlelib","turtledemo","_sysconfigdata_*.pyc")
        shutil.copytree(upstream/"install/lib/python3.12",stdlib,ignore=skip)
        (stdlib/"lib-dynload").mkdir()
        shutil.copytree(upstream/"licenses",legal,dirs_exist_ok=True)
        (legal/"Source.txt").write_text(f"CPython 3.12.14, distribution 20260929, arm64 macOS.\n{ARCHIVE_URL}\nSHA-256: {ARCHIVE_SHA256}\n",encoding="utf-8")

if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path);parser.add_argument("contents",type=Path)
    args=parser.parse_args();prepare(args.archive,args.contents)
