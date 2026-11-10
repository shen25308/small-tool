#!/usr/bin/env python3
"""Deliver a UTF-8 result from stdin to the local Shishi inbox."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import unicodedata
from urllib.parse import urlsplit
from uuid import uuid4

MAX_SUMMARY_BYTES = 64 * 1024
DEFAULT_DIRECTORY = Path.home() / "Library/Application Support/ShiShiDesk/Incoming"


def label(value, field, max_bytes):
    value = unicodedata.normalize("NFC", value.strip())
    if not value or len(value.encode("utf-8")) > max_bytes:
        raise ValueError(f"{field} is required and must fit within {max_bytes} UTF-8 bytes.")
    if any(unicodedata.category(char) in ("Cc", "Cf") for char in value):
        raise ValueError(f"{field} contains control characters.")
    return value


def check_url(url, source):
    if not url:
        return ""
    if len(url.encode("utf-8")) > 2048 or re.search(r"[\s\\\x00-\x1f\x7f]", url):
        raise ValueError("The original conversation URL is too long or contains invalid characters.")
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme != "https" or parts.netloc.lower() not in (host, host + ":443"):
        raise ValueError("Use an HTTPS conversation URL without embedded credentials.")
    name = source.lower()
    valid = False
    if name=="gmail":
        valid = host=="mail.google.com" and parts.path.startswith("/mail/")
    elif name=="outlook":
        valid = host in {"outlook.office.com","outlook.office365.com","outlook.live.com"}
    elif name=="github actions":
        valid = host=="github.com" and bool(re.fullmatch(r"/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(?:/attempts/[0-9]+)?/?",parts.path))
    elif name.startswith("grok") or name in {"xai", "x.ai"}:
        valid = host in {"grok.com", "www.grok.com"} or (
            host in {"x.com", "www.x.com"} and (parts.path == "/i/grok" or parts.path.startswith("/i/grok/")))
    elif name.startswith(("chatgpt", "codex", "openai")):
        valid = host == "chatgpt.com"
    elif name.startswith("claude"):
        valid = host == "claude.ai"
    elif name.startswith("gemini"):
        valid = host == "gemini.google.com"
    if not valid:
        raise ValueError("The URL does not match the source. Supply its official URL or omit the link.")
    return url


def publish(data, directory):
    key_bytes = (data["source"] + "\0" + data["eventID"]).encode("utf-8")
    digest = hashlib.sha256(key_bytes).hexdigest()
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    final = directory / (digest + ".json")
    # A hard link publishes the complete file atomically and preserves the first delivery on a retry.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, prefix=".pending-", delete=False) as fp:
        tmp = Path(fp.name)
        try:
            json.dump(data, fp, ensure_ascii=False, separators=(",", ":"))
            fp.flush()
            os.fsync(fp.fileno())
            try:
                os.link(tmp, final)
            except FileExistsError:
                return digest, False
            return digest, True
        finally:
            tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--event-id", "--id", dest="event_id", help="Stable ID for retries within a source")
    parser.add_argument("--url", default="", help="Optional official conversation URL")
    args = parser.parse_args()
    try:
        source = label(args.source, "Source", 100)
        title = label(args.title, "Title", 640)
        event = label(args.event_id if args.event_id is not None else str(uuid4()), "Event ID", 512)
        text = sys.stdin.buffer.read(MAX_SUMMARY_BYTES + 1)
        if len(text) > MAX_SUMMARY_BYTES:
            raise ValueError("The reply exceeds 64 KiB. Shorten it and try again.")
        summary = text.decode("utf-8").strip()
        if not summary or "\0" in summary:
            raise ValueError("Supply a nonempty reply without null characters.")
        data = dict(version=1, eventID=event, source=source, title=title, summary=summary,
                    time=time.time(), link=check_url(args.url, source))
        directory = Path(os.environ.get("SHISHI_INBOX_DIR", DEFAULT_DIRECTORY))
        key, created = publish(data, directory)
    except (ValueError, OSError) as err:
        parser.exit(1, f"Shishi could not receive the message: {err}\n")
    print(json.dumps({"id": "connector/" + key, "created": created}, ensure_ascii=False))


if __name__ == "__main__":
    main()
