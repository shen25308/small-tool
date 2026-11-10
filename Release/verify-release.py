#!/usr/bin/env python3
"""Read-only check of Shishi's Mac release candidate. Outputs JSON. Never signs or submits."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

PYTHON_ARCHIVE_HASH = "332588681afefc98045995122657a64f8e708d0fb56e683733b1f7cc42157f97"
MODEL_HASH = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
PYTHON_LICENSES = ("bdb", "bzip2", "cpython", "expat", "libX11", "libXau", "libedit", "libffi",
                   "liblzma", "libuuid", "libxcb", "mpdecimal", "ncurses", "openssl-1.1",
                   "openssl-3", "sqlite", "tcl", "tix", "zlib")
DEVELOPER_ID = "anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
MACH_MAGICS = {bytes.fromhex(x) for x in (
    "feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"
)}


def run(*args):
    return subprocess.run(args, capture_output=True, timeout=120, check=False)


def readable(result):
    return (result.stderr + result.stdout).decode(errors="replace").strip()


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def macho_files(contents):
    for path in sorted(contents.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as handle:
            if handle.read(4) in MACH_MAGICS:
                yield path


def signature(code, display_path, executable):
    metadata = readable(run("/usr/bin/codesign", "-d", "--verbose=4", code))
    dev_id = run("/usr/bin/codesign", "--verify", "--strict", "-R=" + DEVELOPER_ID, code)
    ents_data = run("/usr/bin/codesign", "-d", "--entitlements", "-", code)
    ents = plistlib.loads(ents_data.stdout) if ents_data.stdout.strip() else {}
    flags = re.search(r"CodeDirectory [^\n]*\bflags=0x([a-f0-9]+)", metadata, re.I)
    hardened = bool(flags and int(flags.group(1), 16) & 0x10000)
    checks = {
        "developer_id_application_requirement": dev_id.returncode == 0,
        "secure_timestamp": bool(re.search(r"^Timestamp=.+", metadata, re.M)),
        "debug_entitlement_disabled": ents_data.returncode == 0 and not ents.get("com.apple.security.get-task-allow")
    }
    if executable:
        checks["hardened_runtime"] = hardened
    return {"path": display_path, "checks": checks, "pass": all(checks.values())}


def assess(app, artifact, check_ticket):
    app = app.resolve(strict=True)
    contents = app / "Contents"
    info = plistlib.loads((contents / "Info.plist").read_bytes())
    binary = contents / "MacOS" / info["CFBundleExecutable"]
    resources = contents / "Resources"
    if not binary.is_file():
        raise ValueError("Missing declared executable.")
    if sys.platform != "darwin":
        raise ValueError("Run this check on macOS with the macOS command-line tools.")
    main_arch = run("/usr/bin/lipo", "-archs", binary)
    deep = run("/usr/bin/codesign", "--verify", "--deep", "--strict", app)
    items = [signature(app, ".", True)]
    def inspect_nested(path):
        kind = readable(run("/usr/bin/file", "-b", path))
        return signature(path, str(path.relative_to(app)), "executable" in kind)
    with ThreadPoolExecutor(max_workers=6) as pool:
        items.extend(pool.map(inspect_nested, (p for p in macho_files(contents) if p != binary)))
    licenses = resources / "Licenses"
    required_licenses = {
        "Qwen.txt": "Apache License", "llama.cpp.txt": "MIT License", "Components.txt": MODEL_HASH
    }
    attribution = {
        name: (licenses / name).is_file() and needle in (licenses / name).read_text(encoding="utf8")
        for name, needle in required_licenses.items()
    }
    model = resources / "assistant.gguf"
    model_hash = digest(model) if model.is_file() else None
    runtime = contents / "Frameworks" / "Inference" / "llama-completion"
    launcher = contents / "MacOS/shishi-python"
    interpreter = contents / "Helpers/python3.12"
    stdlib = resources / "Python/lib/python3.12"
    python_licenses = licenses / "PythonRuntime"
    provenance = python_licenses / "Source.txt"
    expected = [python_licenses / f"LICENSE.{name}.txt" for name in PYTHON_LICENSES]
    missing = [path.name for path in expected if not path.is_file() or path.stat().st_size == 0]
    python_licensing = {
        "cpython": (python_licenses / "LICENSE.cpython.txt").is_file(),
        "openssl": (python_licenses / "LICENSE.openssl-3.txt").is_file(),
        "upstream_licenses_found": len(expected) - len(missing), "missing": missing,
        "archive_hash_documented": provenance.is_file() and PYTHON_ARCHIVE_HASH in provenance.read_text(encoding="utf8")
    }
    primary = {
        "bundle_signature_integrity": deep.returncode == 0,
        "developer_id_components": all(v["pass"] for v in items),
        "includes_arm64_main": main_arch.returncode == 0 and "arm64" in readable(main_arch).split(),
        "bundled_inference_executable": runtime.is_file(),
        "model_sha256_matches_pinned_weights": model_hash == MODEL_HASH,
        "bundled_model_license_texts": all(attribution.values()),
        "bundled_python_launcher": launcher.is_file() and os.access(launcher, os.X_OK),
        "bundled_python_executable": interpreter.is_file() and os.access(interpreter, os.X_OK),
        "bundled_python_stdlib": (stdlib / "ssl.py").is_file() and (stdlib / "encodings/__init__.py").is_file(),
        "bundled_python_notices": not missing and python_licensing["archive_hash_documented"],
        "mail_and_github_helpers": all((resources / "Mail" / f).is_file() for f in ("bridge.py","mail_http.py","gmail.py","outlook.py","github_actions.py")),
        "absence_of_public_vault_cli": not (contents / "MacOS/MailVault").exists()
    }
    ticket = {"status": "not_checked"}
    if check_ticket:
        result = run("/usr/bin/xcrun", "stapler", "validate", app)
        ticket = {"status": "verified" if result.returncode == 0 else "not_verified",
                  "exit_code": result.returncode, "diagnostic": readable(result)[-900:]}
    distribution = {"status": "not_supplied"}
    if artifact:
        artifact = artifact.resolve(strict=True)
        if not artifact.is_file():
            raise ValueError("--artifact expects a distribution file, such as a ZIP or DMG.")
        distribution = {"status": "fingerprinted_only", "name": artifact.name,
                        "bytes": artifact.stat().st_size, "sha256": digest(artifact)}
    failures = [name for name, ok in primary.items() if not ok]
    if check_ticket and ticket["status"] != "verified":
        failures.append("stapled_ticket_unconfirmed")
    report = {
        "checked_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "app": str(app), "bundle_id": info.get("CFBundleIdentifier"), "version": info.get("CFBundleShortVersionString"),
        "minimum_macos": info.get("LSMinimumSystemVersion"), "main_architectures": readable(main_arch).split(),
        "website_distribution": "local_checks_failed" if failures else "manual_evidence_required",
        "failed_local_checks": failures, "checks": primary, "model_sha256": model_hash,
        "python_licenses": python_licensing, "licenses": attribution, "signed_code": items, "ticket_on_app": ticket, "distribution_file": distribution,
        "external_evidence": {
            "apple_notarization_submission": "not_queried", "quarantined_install_on_clean_mac": "not_tested",
            "google_production_registration_and_review": "not_inspected",
            "microsoft_registration_and_target_tenant_consent": "not_inspected",
            "private_keychain_channel_and_caller_boundary": "requires_separate_integration_test",
            "real_mail_authorization_refresh_disconnect_erase": "not_tested",
            "public_download_privacy_page_and_support": "not_inspected"
        }
    }
    return report, int(bool(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_app = Path(__file__).resolve().parents[2] / "Shishi.app"
    parser.add_argument("app", type=Path, nargs="?", default=default_app)
    parser.add_argument("--artifact", type=Path, help="also fingerprint the proposed ZIP or DMG")
    parser.add_argument("--check-staple", action="store_true", help="run xcrun stapler validate (no submission)")
    args = parser.parse_args()
    try:
        report, status = assess(args.app, args.artifact, args.check_staple)
    except (OSError, ValueError, KeyError, plistlib.InvalidFileException, subprocess.TimeoutExpired) as error:
        report, status = {"website_distribution": "inspection_error", "reason": str(error)}, 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
