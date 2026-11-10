#!/usr/bin/env python3
"""Prepare a Developer ID website release. Without --execute this is a read-only plan.

Plan:
  python3 package-macos.py /path/to/Shishi.app --plan

Sign a separate copy, submit to Apple, staple, verify and create a distributable ZIP:
  python3 package-macos.py /path/to/Shishi.app --execute \
    --identity 'Developer ID Application: Your Name (TEAMID)' \
    --keychain-profile ShiShiNotary --output /path/to/new-release-directory

If processing outlasts the wait, rerun with the same options and --resume WORKDIR.
Configure the notarytool keychain profile separately. This tool never uploads to
a website or edits the original application. --output must be a new directory.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from uuid import UUID

HERE=Path(__file__).resolve().parent
# Import the existing release auditor without producing a cache in the source directory.
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location("shishi_release_audit",HERE/"verify-release.py")
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
BUNDLE_SUFFIXES={".app",".appex",".xpc",".framework",".plugin",".bundle"}


def invoke(args, *, capture=False):
    result=subprocess.run([str(v) for v in args],stdout=subprocess.PIPE if capture else None,
                          text=True,check=True)
    return result.stdout if capture else None


def notarize(operation,argument,profile,extra=()):
    raw=invoke(["/usr/bin/xcrun","notarytool",operation,argument,
                "--keychain-profile",profile,"--output-format","json",*extra],capture=True)
    return json.loads(raw)


def save(path,value):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w",encoding="utf-8",delete=False) as stream:
        try:
            json.dump(value,stream,ensure_ascii=False,indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(stream.name,path)
        finally:
            Path(stream.name).unlink(missing_ok=True)


def code_bundles(app):
    for entry in app.rglob("*"):
        if entry.is_symlink() or not entry.is_dir() or entry.suffix.lower() not in BUNDLE_SUFFIXES:
            continue
        # A .bundle may contain only resources, and must not receive a code signature.
        if entry.suffix.lower()==".framework":
            yield entry
        else:
            info=entry/"Contents/Info.plist"
            if info.is_file() and plistlib.loads(info.read_bytes()).get("CFBundleExecutable"):
                yield entry


def validate_links(app):
    for entry in app.rglob("*"):
        if entry.is_symlink():
            if os.path.isabs(os.readlink(entry)):
                raise ValueError(f"Absolute symlink cannot be relocated with the app: {entry.relative_to(app)}")
            destination=entry.resolve(strict=True)
            if not destination.is_relative_to(app):
                raise ValueError(f"Symlink points outside the app bundle: {entry.relative_to(app)}")


def resolve_identity(identity):
    output=invoke(["/usr/bin/security","find-identity","-v","-p","codesigning"],capture=True)
    valid=re.findall(r'^\s*\d+\)\s+([a-fA-F0-9]{40})\s+"(Developer ID Application: [^"]+)"',output,re.M)
    found={sha.upper() for sha,name in valid if identity.upper()==sha.upper() or identity==name}
    if len(found)!=1:
        raise ValueError("The keychain must contain one valid matching Developer ID Application identity. Use the full certificate name or SHA-1 fingerprint.")
    return found.pop()


def check_bundle(app):
    if app.suffix.lower()!=".app" or not app.is_dir():raise ValueError("Choose an existing .app bundle.")
    info=plistlib.loads((app/"Contents/Info.plist").read_bytes())
    exe=info.get("CFBundleExecutable")
    identifier=info.get("CFBundleIdentifier")
    if (not isinstance(identifier,str) or not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+",identifier)
            or not isinstance(exe,str) or not exe or Path(exe).name!=exe):
        raise ValueError("The bundle identifier or executable name in Info.plist is invalid.")
    if not (app/"Contents/MacOS"/exe).is_file():raise ValueError("The main executable is missing.")
    validate_links(app)
    return info


def verify_candidate(app):
    report,code=audit.assess(app,None,False)
    if code:
        raise ValueError("The signed copy failed verification before notarization: "+", ".join(report["failed_local_checks"]))


def create_submission(app,work,identity,profile):
    app_copy=work/app.name
    invoke(["/usr/bin/ditto",app,app_copy])
    validate_links(app_copy)
    sign=["/usr/bin/codesign","--force","--sign",identity,"--timestamp","--options","runtime"]
    for code in audit.macho_files(app_copy/"Contents"):
        invoke([*sign,code])
    for bundle in sorted(code_bundles(app_copy),key=lambda p:len(p.parts),reverse=True):
        invoke([*sign,bundle])
    invoke([*sign,app_copy])
    verify_candidate(app_copy)
    archive=work/"submission.zip"
    invoke(["/usr/bin/ditto","-c","-k","--sequesterRsrc","--keepParent",app_copy,archive])
    info=check_bundle(app_copy)
    state={"app":app.name,"bundleID":info["CFBundleIdentifier"],"version":info["CFBundleShortVersionString"],"identity":identity,"inputSha256":audit.digest(archive)}
    save(work/"submission.json",state)
    print("Submitting the package to Apple for notarization.",flush=True)
    ticket=notarize("submit",archive,profile,["--no-wait"])
    state["id"]=str(UUID(str(ticket["id"])))
    save(work/"submission.json",state)
    return state


def finish_submission(work,state,output,profile,wait_limit):
    archive=work/"submission.zip"
    if audit.digest(archive)!=state.get("inputSha256"):
        raise ValueError("The submission ZIP in the working directory has changed.")
    submission_id=str(UUID(str(state["id"])))
    print("Apple notarization submission ID: "+submission_id,flush=True)
    # Query before waiting; restarting after a timeout does not submit the same ZIP again.
    response=notarize("info",submission_id,profile)
    if response.get("status")=="In Progress":
        response=notarize("wait",submission_id,profile,["--timeout",wait_limit])
    if response.get("status")!="Accepted":
        raise ValueError("Notarization has not been accepted. Current status: "+str(response.get("status"))+". Inspect this submission ID with notarytool info or log.")
    with tempfile.TemporaryDirectory(prefix=".verified-",dir=work) as scratch:
        check=Path(scratch)
        # Extract exactly the binary Apple reviewed, even on a later retry.
        invoke(["/usr/bin/ditto","-x","-k",archive,check])
        app=check/state["app"]
        verify_candidate(app)
        invoke(["/usr/bin/xcrun","stapler","staple",app])
        invoke(["/usr/bin/xcrun","stapler","validate",app])
        stage=Path(tempfile.mkdtemp(prefix=".shishi-release-",dir=output.parent))
        try:
            package=stage/(app.stem+".zip")
            invoke(["/usr/bin/ditto","-c","-k","--sequesterRsrc","--keepParent",app,package])
            extracted=check/"reopen"
            extracted.mkdir()
            invoke(["/usr/bin/ditto","-x","-k",package,extracted])
            candidate=extracted/app.name
            report,invalid=audit.assess(candidate,package,True)
            if invalid:raise ValueError("Verification of the extracted distribution archive failed: "+", ".join(report["failed_local_checks"]))
            invoke(["/usr/sbin/spctl","--assess","--type","execute","--verbose=2",candidate])
            sha=report["distribution_file"]["sha256"]
            (stage/"SHA256SUMS.txt").write_text(sha+"  "+package.name+"\n",encoding="utf-8")
            save(stage/"apple-notarization.json",{"id":submission_id,"status":"Accepted","submittedSha256":state["inputSha256"]})
            report["external_evidence"]["apple_notarization_submission"]="accepted: "+submission_id
            report["gatekeeper_current_mac"]="accepted_after_final_zip_extraction"
            save(stage/"verification.json",report)
            if output.exists():raise ValueError("The output directory already exists.")
            stage.rename(output)
            print("Local distribution archive: "+str(output/package.name))
        finally:
            if stage.exists():shutil.rmtree(stage)


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("app",nargs="?",type=Path,default=HERE.parents[1]/"Shishi.app")
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--plan",action="store_true",help="Print the packaging plan without changing files (default)")
    mode.add_argument("--execute",action="store_true",help="Sign a copy and submit its ZIP to Apple")
    parser.add_argument("--identity",help="Full Developer ID Application certificate name or SHA-1 fingerprint")
    parser.add_argument("--keychain-profile",help="Name of a local notarytool keychain profile")
    parser.add_argument("--output",type=Path,help="New directory for the distribution files")
    parser.add_argument("--resume",type=Path,help="Resume a working directory that already has an Apple submission ID")
    parser.add_argument("--wait-limit",default="45m",help="Maximum wait for this run, for example 45m or 1h")
    args=parser.parse_args()
    if args.execute and not (args.identity and args.keychain_profile):
        parser.error("--execute requires both --identity and --keychain-profile.")
    if not re.fullmatch(r"[1-9]\d*(?:s|m|h)?",args.wait_limit):parser.error("Invalid --wait-limit.")
    app=args.app.resolve(strict=True)
    info=check_bundle(app)
    output=(args.output or Path.cwd()/("Shishi-"+info["CFBundleShortVersionString"]+"-distribution")).resolve()
    if output==app or output.is_relative_to(app):raise ValueError("The output directory must be outside the source app.")
    plan={"mode":"execute" if args.execute else "plan","source":str(app),"version":info["CFBundleShortVersionString"],
          "machoFiles":len(list(audit.macho_files(app/"Contents"))),"nestedBundles":len(list(code_bundles(app))),
          "localOutput":str(output),"appleUpload":bool(args.execute),"required":["Developer ID Application","notarytool keychain profile"],
          "steps":["Copy the app","Sign components from the inside out with secure timestamps","Verify signatures and bundled resources","Submit to Apple for notarization","Staple the ticket to the copy","Create and extract the final ZIP","Verify Gatekeeper acceptance and the SHA-256 digest"]}
    print(json.dumps(plan,ensure_ascii=False,indent=2),flush=True)
    if not args.execute:return
    if sys.platform!="darwin":raise ValueError("Distribution signing requires macOS.")
    if output.exists():raise ValueError("The output directory already exists. Choose a new directory.")
    identity=resolve_identity(args.identity)
    for tool in ("notarytool","stapler"):invoke(["/usr/bin/xcrun","--find",tool],capture=True)
    output.parent.mkdir(parents=True,exist_ok=True)
    work=args.resume.resolve(strict=True) if args.resume else Path(tempfile.mkdtemp(prefix=".shishi-notary-",dir=output.parent))
    if work==app or work.is_relative_to(app) or output.is_relative_to(work):
        raise ValueError("The submission, output and source app directories must be separate.")
    print("Submission working directory: "+str(work),flush=True)
    lock_path=work/".packaging.lock"
    with lock_path.open("a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError("A packaging job is already using this directory.") from None
        if args.resume:
            state=json.loads((work/"submission.json").read_text(encoding="utf-8"))
            if (state.get("app")!=app.name or state.get("bundleID")!=info["CFBundleIdentifier"] or state.get("version")!=info["CFBundleShortVersionString"]
                    or state.get("identity")!=identity or not state.get("id")):
                raise ValueError("The recorded bundle name, certificate or Apple submission ID does not match.")
        else:
            state=create_submission(app,work,identity,args.keychain_profile)
        finish_submission(work,state,output,args.keychain_profile,args.wait_limit)
    if not args.resume:shutil.rmtree(work)


if __name__=="__main__":
    try:
        main()
    except (OSError,ValueError,KeyError,subprocess.SubprocessError,plistlib.InvalidFileException) as err:
        sys.exit("Packaging did not finish: "+str(err))
