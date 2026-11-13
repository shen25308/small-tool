#!/usr/bin/env python3
"""How much Claude Code and Codex have been used, read only from their own session files on this Mac.

Claude Code: token counts from the usage block each reply records in ~/.claude/projects/**/*.jsonl, for the last
5 hours, today and the last 7 days. Anthropic does not store plan limits locally, so there is no percentage.
Codex: the most recent rate-limit snapshot Codex itself wrote into ~/.codex/sessions (percent used, window and
reset time). Nothing is sent anywhere. Prints one JSON object.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

WEEK = 7 * 24 * 3600
MAX_FILE_BYTES = 64 * 1024 * 1024


def parse_time(value):
    if isinstance(value, (int, float)):
        return float(value) / (1000 if value > 1e12 else 1)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def recent_files(root, pattern, since):
    if not root.is_dir():
        return []
    found = []
    for path in root.rglob(pattern):
        try:
            info = path.stat()
        except OSError:
            continue
        if info.st_mtime >= since and info.st_size <= MAX_FILE_BYTES and path.is_file() and not path.is_symlink():
            found.append(path)
    return found


def as_count(value):
    return value if isinstance(value, int) and 0 <= value < 10**10 else 0


def claude_usage(home, now):
    windows = {"fiveHours": now - 5 * 3600, "today": datetime.fromtimestamp(now).replace(hour=0, minute=0, second=0, microsecond=0).timestamp(),
               "week": now - WEEK}
    totals = {name: {"input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0, "replies": 0} for name in windows}
    seen, sessions = set(), set()
    for path in recent_files(home / "projects", "*.jsonl", now - WEEK):
        try:
            stream = path.open("rb")
        except OSError:
            continue
        with stream:
            for line in stream:
                if b'"usage"' not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                message = row.get("message") if isinstance(row, dict) else None
                usage = message.get("usage") if isinstance(message, dict) else None
                when = parse_time(row.get("timestamp"))
                if row.get("type") != "assistant" or not isinstance(usage, dict) or when is None or when < windows["week"]:
                    continue
                # A streamed reply can be written more than once with the same message and request IDs.
                identity = (message.get("id"), row.get("requestId"))
                if identity[0] and identity in seen:
                    continue
                seen.add(identity)
                sessions.add(row.get("sessionId"))
                for name, since in windows.items():
                    if when >= since:
                        bucket = totals[name]
                        bucket["input"] += as_count(usage.get("input_tokens"))
                        bucket["output"] += as_count(usage.get("output_tokens"))
                        bucket["cacheWrite"] += as_count(usage.get("cache_creation_input_tokens"))
                        bucket["cacheRead"] += as_count(usage.get("cache_read_input_tokens"))
                        bucket["replies"] += 1
    for bucket in totals.values():
        # Cache reads are cheap and very large; they are shown separately and left out of the main number.
        bucket["tokens"] = bucket["input"] + bucket["output"] + bucket["cacheWrite"]
    totals["sessions"] = len(sessions - {None})
    return totals


def codex_window(value, observed):
    if not isinstance(value, dict):
        return None
    used = value.get("used_percent", value.get("used_percentage"))
    if not isinstance(used, (int, float)) or not 0 <= used <= 1000:
        return None
    window = value.get("window_minutes")
    resets = value.get("resets_at")
    if not isinstance(resets, (int, float)) and isinstance(value.get("resets_in_seconds"), (int, float)) and observed:
        resets = observed + value["resets_in_seconds"]
    return {"usedPercent": round(float(used), 1), "windowMinutes": window if isinstance(window, int) else None,
            "resetsAt": float(resets) if isinstance(resets, (int, float)) else None}


def codex_limits(home, now):
    latest = None
    for path in recent_files(home / "sessions", "*.jsonl", now - WEEK):
        try:
            with path.open("rb") as stream:
                stream.seek(max(0, path.stat().st_size - 512 * 1024))
                lines = stream.read().splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            if b'"rate_limits"' not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            payload = row.get("payload") if isinstance(row, dict) else None
            limits = payload.get("rate_limits") if isinstance(payload, dict) else None
            observed = parse_time(row.get("timestamp")) or path.stat().st_mtime
            if isinstance(limits, dict) and (latest is None or observed > latest[0]):
                latest = (observed, limits)
            break
    if latest is None:
        return None
    observed, limits = latest
    result = {"observedAt": observed}
    for name in ("primary", "secondary"):
        window = codex_window(limits.get(name), observed)
        if window:
            result[name] = window
    return result if len(result) > 1 else None


def main():
    now = time.time()
    claude_home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    codex_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    report = {"ok": True, "time": now, "claude": claude_usage(claude_home, now) if (claude_home / "projects").is_dir() else None,
              "codex": codex_limits(codex_home, now)}
    json.dump(report, sys.stdout)


if __name__ == "__main__":
    main()
