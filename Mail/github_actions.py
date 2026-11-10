#!/usr/bin/env python3
"""Watch a selected public GitHub repository's Actions runs without credentials.

The app sends one JSON command on stdin. Active subscriptions persist across
launches. The foreground inbox and the background timer share the same lock
and rate gate. Old pages are revisited to find reruns of older workflow runs.
"""
from datetime import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib import error, parse, request

from bridge import atomic_save
from mail_http import NoRedirect, has_legacy_status

SUPPORT = Path.home() / "Library/Application Support/ShiShiDesk"
POLL_INTERVAL = 300
PAGE_SIZE = 50
API = "https://api.github.com"
OPENER = request.build_opener(NoRedirect())
CONCLUSIONS = {
    "success":"Succeeded", "failure":"Failed", "cancelled":"Canceled", "skipped":"Skipped",
    "timed_out":"Timed out", "action_required":"Action required", "neutral":"Neutral",
    "stale":"Stale", "startup_failure":"Failed to start",
}
sender_path = Path(__file__).resolve().parent.parent / "Connectors/shishi-send.py"
spec = importlib.util.spec_from_file_location("shishi_actions_sender", sender_path)
sender = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sender)


class ServiceError(Exception):
    def __init__(self, message, *, status=0, retry_at=0):
        super().__init__(message)
        self.status = status
        self.retry_at = retry_at


def github_get(path):
    headers = {"User-Agent":"Shishi-Desktop", "Accept":"application/vnd.github+json",
               "X-GitHub-Api-Version":"2022-11-28"}
    req = request.Request(API + path, headers=headers)
    try:
        with OPENER.open(req, timeout=10) as response:
            raw = response.read(4*1024*1024+1)
            if len(raw)>4*1024*1024:
                raise ServiceError("The GitHub response was too large. Try again later.")
            data=json.loads(raw)
            if not isinstance(data,dict):
                raise ServiceError("GitHub returned an invalid workflow list.")
            remaining=response.headers.get("X-RateLimit-Remaining","")
            reset=response.headers.get("X-RateLimit-Reset","")
            limited_until=int(reset)+2 if remaining.isdecimal() and int(remaining)<3 and reset.isdecimal() else 0
            return data, limited_until
    except error.HTTPError as exc:
        now=time.time()
        retry=exc.headers.get("Retry-After","")
        remaining=exc.headers.get("X-RateLimit-Remaining")
        reset=exc.headers.get("X-RateLimit-Reset","")
        if exc.code==429 or (exc.code==403 and (remaining=="0" or retry)):
            wait_until=now+int(retry) if retry.isdecimal() else int(reset)+2 if reset.isdecimal() else now+POLL_INTERVAL
            raise ServiceError("GitHub rate-limited this request. Shishi will retry automatically.",status=exc.code,retry_at=wait_until) from None
        if exc.code==404:
            raise ServiceError("Check that the repository name is correct, the repository is public, and the workflow run still exists.",status=404) from None
        if exc.code in (301,302,307,308):
            raise ServiceError("The repository was renamed. Use its current name on GitHub.",status=exc.code) from None
        raise ServiceError(f"GitHub could not return the workflows (HTTP {exc.code}).",status=exc.code) from None
    except (OSError, ValueError) as exc:
        raise ServiceError("Could not reach GitHub. Check your connection and try again.") from None


def repo_name(raw):
    if not isinstance(raw,str):
        raise ValueError("Enter a public GitHub repository as owner/repo.")
    value=raw.strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}",value) or value.split("/")[1] in {".",".."}:
        raise ValueError("Enter a public GitHub repository as owner/repo.")
    return value


def workflow_name(raw):
    if not isinstance(raw,str) or len(raw)>160 or any(unicodedata.category(ch) in {"Cc","Cf"} for ch in raw):
        raise ValueError("Invalid workflow name.")
    return raw.strip()


def clean(raw, limit):
    value="".join(" " if unicodedata.category(ch) in {"Cc","Cf"} else ch for ch in str(raw or ""))
    return " ".join(value.split())[:limit]


def stamp(iso):
    if not isinstance(iso,str):
        return 0
    try:
        return datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()
    except (ValueError,OverflowError):
        return 0


def page(repo,page_number):
    path = "/repos/"+repo+"/actions/runs?"+parse.urlencode({"per_page":PAGE_SIZE,"page":page_number})
    result,limit=github_get(path)
    rows=result.get("workflow_runs")
    if not isinstance(rows,list):
        raise ServiceError("GitHub did not return a list of workflow runs.")
    return rows,limit


def collect(state,rows,at,*,baseline=False,backfill=False):
    published=0
    pending=state["pending"]
    for run in rows:
        if not isinstance(run,dict) or not isinstance(run.get("id"),int) or run["id"]<=0:
            continue
        name=clean(run.get("name"),160)
        if state["workflow"] and state["workflow"]!=name:
            continue
        uid=str(run["id"])
        attempt=run.get("run_attempt") or 1
        if not isinstance(attempt,int) or attempt<1:
            continue
        if run.get("status")!="completed":
            if baseline: state["lastAttempt"][uid]=max(0,attempt-1)
            pending.setdefault(uid,at)
            continue
        if not backfill:
            pending.pop(uid,None)
        ended=stamp(run.get("updated_at"))
        previous=state["lastAttempt"].get(uid,0)
        if not backfill:
            if ended>=state["since"] and attempt>previous+1 and not baseline:
                # GitHub's main list returns the newest attempt only. Retrieve
                # earlier attempts separately if several finished between polls.
                state["gaps"].append([uid,previous+1,attempt-1])
            state["lastAttempt"][uid]=max(previous,attempt)
        if ended < state["since"]:
            continue
        event_key=f"{uid}/{attempt}"
        if baseline and ended==state["since"]:
            state["boundary"].append(event_key)
        if ended==state["since"] and event_key in state["boundary"]:
            continue
        branch=clean(run.get("head_branch"),150)
        conclusion=clean(run.get("conclusion"),35)
        status=CONCLUSIONS.get(conclusion,conclusion or "Completed")
        repo=state["repo"]
        title=clean(f"{name or 'GitHub workflow'} · {status}",145)
        summary=f"{repo} · {name or 'Workflow'}\nResult: {status}"
        if branch:
            summary+=f"\nBranch: {branch}"
        summary+=f"\nRun #{run.get('run_number') or uid}, attempt {attempt}"
        link=f"https://github.com/{repo}/actions/runs/{uid}/attempts/{attempt}"
        event={"version":1, "source":"GitHub Actions", "eventID":f"{repo.lower()}/{uid}/{attempt}",
               "title":title,"summary":summary,"time":ended,"link":link}
        _,added=sender.publish(event,SUPPORT/"Incoming")
        published+=int(added)
    return published


def disabled():
    return {"connected":False,"repo":"","workflow":"","lastSync":0,"nextSync":0,"error":""}


def public(state, ok=True, **extra):
    fields={k:state[k] for k in ("connected","repo","workflow","lastSync","nextSync","error")}
    if has_legacy_status(fields["error"]):
        fields["error"] = "GitHub sync failed. Check the repository and try again."
    return dict(fields,ok=ok,created=extra.get("added",0),**extra)


def run(command):
    op=command.get("op")
    file=SUPPORT/"GitHubActions.json"
    # Before the first subscription, status and scheduled sync do no I/O beyond this check.
    if op in {"status","sync","disconnect"} and not file.exists():
        return public(disabled())
    SUPPORT.mkdir(mode=0o700,parents=True,exist_ok=True)
    with os.fdopen(os.open(SUPPORT/"GitHubActions.lock",os.O_RDWR|os.O_CREAT,0o600),"a+") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        state=json.loads(file.read_text(encoding="utf-8")) if file.exists() else disabled()
        at=time.time()
        if op=="status":
            return public(state)
        if op=="disconnect":
            file.unlink(missing_ok=True)
            return public(disabled())
        if op=="connect":
            repo=repo_name(command.get("repo"))
            workflow=workflow_name(command.get("workflow",""))
            if state["connected"] and state["repo"].lower()==repo.lower() and state["workflow"]==workflow:
                return public(state)
            try:
                rows,limit=page(repo,1)
            except ServiceError as exc:
                return dict(public(state,False),error=str(exc))
            state=dict(disabled(),connected=True,repo=repo,workflow=workflow,since=int(at),
                       pending={},olderPage=2,lastAttempt={},gaps=[],lastFollowup="",boundary=[],
                       lastSync=at,nextSync=max(limit,at+POLL_INTERVAL))
            count=collect(state,rows,at,baseline=True)
            atomic_save(file,state)
            return public(state,added=count)
        if op!="sync":
            raise ValueError("Use status, connect, sync, or disconnect.")
        if not state["connected"] or at<state["nextSync"]:
            return public(state)
        count=0
        state["nextSync"]=at+POLL_INTERVAL
        try:
            rows,limit=page(state["repo"],1)
            count+=collect(state,rows,at)
            observed={str(r["id"]) for r in rows if isinstance(r,dict) and "id" in r}
            if not limit and len(rows)>=PAGE_SIZE:
                older,limit=page(state["repo"],state["olderPage"])
                count+=collect(state,older,at)
                observed.update(str(r["id"]) for r in older if isinstance(r,dict) and "id" in r)
                state["olderPage"]=state["olderPage"]+1 if len(older)>=PAGE_SIZE else 2
            # Reserve the third request for one tracked run or one historical
            # attempt. Both queues make progress even on a busy repository.
            missing=[key for key in state["pending"] if key not in observed]
            fetch_gap=state["gaps"] and (not missing or state["lastFollowup"]!="gap")
            if not limit and fetch_gap:
                uid,low,high=state["gaps"][0]
                try:
                    detail,limit=github_get(f"/repos/{state['repo']}/actions/runs/{uid}/attempts/{high}")
                    count+=collect(state,[detail],at,backfill=True)
                    before_start=stamp(detail.get("updated_at"))<state["since"]
                except ServiceError as exc:
                    if exc.status!=404: raise
                    before_start=False
                state["gaps"].pop(0)
                if not before_start and high>low:
                    state["gaps"].append([uid,low,high-1])
                state["lastFollowup"]="gap"
            elif not limit and missing:
                uid=min(missing,key=state["pending"].get)
                try:
                    detail,limit=github_get("/repos/"+state["repo"]+"/actions/runs/"+uid)
                    state["pending"][uid]=at
                    count+=collect(state,[detail],at)
                except ServiceError as exc:
                    if exc.status!=404: raise
                    state["pending"].pop(uid,None)
                state["lastFollowup"]="run"
            state["lastSync"],state["error"]=at,""
            state["nextSync"]=max(state["nextSync"],limit)
        except ServiceError as exc:
            state["error"]=str(exc)
            state["nextSync"]=max(state["nextSync"],exc.retry_at)
        atomic_save(file,state)
        return public(state,not bool(state["error"]),added=count)


if __name__=="__main__":
    try:
        command=json.load(sys.stdin)
        if not isinstance(command,dict):
            raise ValueError("Invalid command format.")
        print(json.dumps(run(command),ensure_ascii=False))
    except (OSError,ValueError,KeyError,TypeError) as exc:
        print(json.dumps(dict(public(disabled(),False),error=clean(str(exc),250)),ensure_ascii=False))
