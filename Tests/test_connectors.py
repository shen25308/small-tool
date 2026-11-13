"""Run with: python3 -m unittest discover -s Tests"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECEIVE = ROOT / "ClaudeCode" / "receive.py"
INSTALL = ROOT / "ClaudeCode" / "install.py"
AGENTS = ROOT / "Connectors" / "shishi_agents.py"


class Sandbox(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.base = Path(self.folder.name)
        self.env = dict(os.environ, SHISHI_AGENTS_DIR=str(self.base / "Agents"),
                        SHISHI_INBOX_DIR=str(self.base / "Incoming"), HOME=str(self.base / "home"))
        self.env.pop("CLAUDE_CONFIG_DIR", None)

    def tearDown(self):
        self.folder.cleanup()

    def run_script(self, script, *args, stdin=""):
        return subprocess.run([sys.executable, "-B", str(script), *args], input=stdin, text=True,
                              capture_output=True, env=self.env, timeout=30)

    def hook(self, **event):
        base = {"session_id": "s-1", "cwd": "/Users/me/code/small-tool", "transcript_path": ""}
        result = self.run_script(RECEIVE, stdin=json.dumps({**base, **event}))
        self.assertEqual(result.stdout, "", "a hook must not print to standard output")
        return result

    def states(self):
        folder = self.base / "Agents"
        return [json.loads(p.read_text()) for p in sorted(folder.glob("*.json"))] if folder.exists() else []

    def receipts(self):
        folder = self.base / "Incoming"
        return [json.loads(p.read_text()) for p in sorted(folder.glob("*.json"))] if folder.exists() else []


class ClaudeCodeHook(Sandbox):
    def test_prompt_then_stop_leaves_status_and_receipt(self):
        self.assertEqual(self.hook(hook_event_name="UserPromptSubmit", prompt="Fix the login bug\nand add tests").returncode, 0)
        state, = self.states()
        self.assertEqual((state["state"], state["source"], state["title"]), ("working", "Claude Code", "Claude Code · small-tool"))
        self.assertEqual(state["detail"], "Fix the login bug and add tests")

        done = self.hook(hook_event_name="Stop", prompt_id="p-1", last_assistant_message="Fixed `auth.py`. Tests pass.")
        self.assertEqual(done.returncode, 0, done.stderr)
        state, = self.states()
        self.assertEqual(state["state"], "done")
        receipt, = self.receipts()
        self.assertEqual((receipt["source"], receipt["title"], receipt["summary"]),
                         ("Claude Code", "Claude Code · small-tool", "Fixed `auth.py`. Tests pass."))
        digest = hashlib.sha256(("Claude Code\0" + receipt["eventID"]).encode()).hexdigest()
        self.assertEqual(state["receipt"], "connector/" + digest)
        self.assertTrue((self.base / "Incoming" / (digest + ".json")).is_file())

    def test_report_details_survive_to_the_finished_state(self):
        self.env["__CFBundleIdentifier"] = "com.googlecode.iterm2"
        self.hook(hook_event_name="UserPromptSubmit", prompt="Fix the login bug")
        started = self.states()[0]["started"]
        self.env.pop("__CFBundleIdentifier")
        self.env["TERM_PROGRAM"] = "Apple_Terminal"
        self.hook(hook_event_name="Notification", notification_type="permission_prompt", message="Allow Bash?")
        self.hook(hook_event_name="Stop", last_assistant_message="Fixed it.")
        state, = self.states()
        self.assertEqual((state["state"], state["task"], state["started"]), ("done", "Fix the login bug", started))
        self.assertEqual(state["app"], "com.apple.Terminal")
        self.assertGreaterEqual(state["time"], started)

    def test_unusual_bundle_ids_are_ignored(self):
        self.env["__CFBundleIdentifier"] = "../../etc; rm -rf"
        self.env.pop("TERM_PROGRAM", None)
        self.hook(hook_event_name="UserPromptSubmit", prompt="hi")
        self.assertNotIn("app", self.states()[0])

    def test_retry_is_deduplicated_and_new_reply_is_kept(self):
        for _ in range(2):
            self.hook(hook_event_name="Stop", prompt_id="p-1", last_assistant_message="First answer")
        self.assertEqual(len(self.receipts()), 1)
        self.hook(hook_event_name="Stop", prompt_id="p-1", last_assistant_message="Answer after a background task")
        self.assertEqual(len(self.receipts()), 2)

    def test_permission_prompt_then_tool_use(self):
        self.hook(hook_event_name="UserPromptSubmit", prompt="Deploy the site")
        self.hook(hook_event_name="PostToolUse", tool_name="Read")
        self.assertEqual(self.states()[0]["state"], "working")
        self.hook(hook_event_name="Notification", notification_type="permission_prompt", message="Claude needs your permission to use Bash")
        state, = self.states()
        self.assertEqual((state["state"], state["detail"]), ("attention", "Claude needs your permission to use Bash"))
        self.hook(hook_event_name="PostToolUse", tool_name="Bash")
        state, = self.states()
        self.assertEqual((state["state"], state["detail"]), ("working", "Deploy the site"))

    def test_tool_activity_and_process_are_recorded(self):
        self.hook(hook_event_name="UserPromptSubmit", prompt="Refactor billing")
        self.assertEqual(self.states()[0]["pid"], os.getpid(), "the process that ran the hook")
        self.hook(hook_event_name="PostToolUse", tool_name="Edit", tool_input={"file_path": "/Users/me/code/small-tool/billing.py", "old_string": "secret"})
        self.hook(hook_event_name="PostToolUse", tool_name="Bash", tool_input={"command": "pytest  -q\n tests/test_billing.py"})
        state, = self.states()
        self.assertEqual((state["state"], state["activity"], state["tools"]), ("working", "Bash: pytest -q tests/test_billing.py", 2))
        self.hook(hook_event_name="PostToolUse", tool_name="Task", tool_input={"description": "Review the migration"})
        self.assertEqual(self.states()[0]["activity"], "Subagent: Review the migration")
        # A late tool event never reopens a finished turn, and a new prompt starts the count again.
        self.hook(hook_event_name="Stop", last_assistant_message="Done.")
        self.hook(hook_event_name="PostToolUse", tool_name="Read", tool_input={"file_path": "/x/a.py"})
        self.assertEqual(self.states()[0]["state"], "done")
        self.hook(hook_event_name="UserPromptSubmit", prompt="Next")
        self.assertNotIn("tools", self.states()[0])

    def test_delivery_log_keeps_no_content(self):
        self.hook(hook_event_name="UserPromptSubmit", prompt="My private prompt about payroll")
        self.hook(hook_event_name="PostToolUse", tool_name="Bash", tool_input={"command": "cat salaries.csv"})
        result = self.run_script(RECEIVE, stdin="not json")
        self.assertEqual(result.returncode, 1)
        log = (self.base / "HookLog.jsonl").read_text()
        rows = [json.loads(line) for line in log.splitlines()]
        self.assertEqual([row["event"] for row in rows], ["UserPromptSubmit", "PostToolUse", ""])
        self.assertEqual(rows[0]["outcome"], "delivered")
        self.assertTrue(rows[2]["outcome"].startswith("problem:"))
        self.assertNotIn("payroll", log)
        self.assertNotIn("salaries", log)
        self.assertNotIn("s-1", log)
        for _ in range(3):
            self.hook(hook_event_name="SessionEnd")
        self.assertLessEqual(len((self.base / "HookLog.jsonl").read_text().splitlines()), 200)

    def test_other_notifications_and_subagents_are_ignored(self):
        self.hook(hook_event_name="Notification", notification_type="auth_success", message="Signed in")
        self.hook(hook_event_name="Stop", agent_id="a-1", last_assistant_message="Subagent result")
        self.assertEqual(self.states(), [])
        self.assertEqual(self.receipts(), [])

    def test_session_end_clears_unfinished_but_keeps_finished(self):
        self.hook(hook_event_name="UserPromptSubmit", prompt="Explore")
        self.hook(hook_event_name="SessionEnd", reason="prompt_input_exit")
        self.assertEqual(self.states(), [])
        self.hook(hook_event_name="Stop", last_assistant_message="All done")
        self.hook(hook_event_name="SessionEnd", reason="other")
        self.assertEqual(self.states()[0]["state"], "done")

    def test_reply_falls_back_to_transcript_and_session_title(self):
        transcript = self.base / "t.jsonl"
        rows = [
            {"type": "user", "message": {"content": "hi"}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "Earlier reply"}]}},
            {"type": "assistant", "isSidechain": True, "message": {"content": [{"type": "text", "text": "Subagent"}]}},
            {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "…"}, {"type": "text", "text": "Final reply 你好"}]}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash"}]}},
        ]
        transcript.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
        self.hook(hook_event_name="UserPromptSubmit", prompt="go", session_title="Billing refactor")
        self.hook(hook_event_name="Stop", transcript_path=str(transcript))
        receipt, = self.receipts()
        self.assertEqual((receipt["summary"], receipt["title"]), ("Final reply 你好", "Claude Code · Billing refactor"))

    def write_transcript(self, rows):
        path = self.base / "session.jsonl"
        path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
        return str(path)

    @staticmethod
    def tool(call_id, name, **arguments):
        return {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": call_id, "name": name, "input": arguments}]}}

    @staticmethod
    def result(call_id, body, error=False):
        part = {"type": "tool_result", "tool_use_id": call_id, "content": body}
        if error:
            part["is_error"] = True
        return {"type": "user", "message": {"content": [part]}}

    def test_facts_come_from_the_session_log(self):
        cwd = "/Users/me/code/shop"
        rows = [
            {"type": "user", "message": {"content": "Earlier request"}},
            self.tool("old", "Edit", file_path=cwd + "/old.py"),
            self.result("old", "ok"),
            {"type": "user", "message": {"content": "Add refunds"}},
            {"type": "user", "isMeta": True, "message": {"content": "<system-reminder>ignored</system-reminder>"}},
            self.tool("a", "Read", file_path=cwd + "/billing.py"),
            self.result("a", "file text"),
            self.tool("b", "Edit", file_path=cwd + "/billing.py", old_string="x", new_string="y"),
            self.result("b", "updated"),
            self.tool("c", "Write", file_path=cwd + "/tests/test_refunds.py", content="..."),
            self.result("c", "created"),
            self.tool("d", "Bash", command="npm   test"),
            self.result("d", "Exit code 1\n2 failing", error=True),
            self.tool("e", "Edit", file_path=cwd + "/billing.py", old_string="y", new_string="z"),
            self.result("e", "updated"),
            self.tool("f", "Bash", command="npm test"),
            self.result("f", "48 passing"),
            self.tool("g", "Bash", command="git status"),
            self.result("g", "clean"),
            {"type": "assistant", "isSidechain": True, "message": {"content": [{"type": "tool_use", "id": "s", "name": "Edit", "input": {"file_path": "/elsewhere.py"}}]}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "Done. Tests pass."}]}},
        ]
        self.hook(hook_event_name="Stop", cwd=cwd, transcript_path=self.write_transcript(rows), last_assistant_message="Done. Tests pass.")
        facts = self.states()[0]["facts"]
        self.assertEqual(facts, {"files": ["billing.py", "tests/test_refunds.py"], "fileCount": 2, "commands": 3,
                                 "failedTools": 1, "tests": "passed", "testCommand": "npm test"})

    def test_facts_report_missing_and_failing_checks(self):
        cwd = "/Users/me/code/shop"
        untested = [{"type": "user", "message": {"content": [{"type": "text", "text": "Fix it"}]}},
                    self.tool("a", "Edit", file_path="/tmp/outside.py"), self.result("a", "updated")]
        self.hook(hook_event_name="Stop", session_id="s-a", cwd=cwd, transcript_path=self.write_transcript(untested), last_assistant_message="Fixed.")
        facts = next(state for state in self.states() if state["session"] == "s-a")["facts"]
        self.assertEqual((facts["tests"], facts["files"], facts["commands"]), ("none", ["/tmp/outside.py"], 0))
        failing = [{"type": "user", "message": {"content": "Build it"}},
                   self.tool("a", "Bash", command="cargo build && cargo test"), self.result("a", "Exit code 101\nerror[E0308]")]
        self.hook(hook_event_name="Stop", session_id="s-b", cwd=cwd, transcript_path=self.write_transcript(failing), last_assistant_message="Built.")
        facts = next(state for state in self.states() if state["session"] == "s-b")["facts"]
        self.assertEqual((facts["tests"], facts["testCommand"]), ("failed", "cargo build && cargo test"))
        self.hook(hook_event_name="Stop", session_id="s-c", cwd=cwd, transcript_path=str(self.base / "missing.jsonl"), last_assistant_message="Ok.")
        self.assertNotIn("facts", next(state for state in self.states() if state["session"] == "s-c"))

    def test_long_reply_is_trimmed_and_bad_input_never_blocks(self):
        result = self.hook(hook_event_name="Stop", last_assistant_message="é" * 80000)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLessEqual(len(self.receipts()[0]["summary"].encode()), 64 * 1024)
        broken = self.run_script(RECEIVE, stdin="not json")
        self.assertEqual(broken.returncode, 1)
        self.assertNotEqual(broken.returncode, 2)


class ClaudeCodeInstaller(Sandbox):
    def setUp(self):
        super().setUp()
        self.home = self.base / "claude"
        self.settings = self.home / "settings.json"

    def install(self, action):
        result = self.run_script(INSTALL, action, "--json", "--claude-home", str(self.home))
        return json.loads(result.stdout)

    def test_install_keeps_other_settings_and_remove_restores_them(self):
        self.home.mkdir()
        original = {"model": "opus", "permissions": {"allow": ["Bash(npm test)"]}, "hooks": {
            "Stop": [{"hooks": [{"type": "command", "command": "afplay /System/Library/Sounds/Glass.aiff"}]}],
            "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "./guard.sh"}]}]}}
        self.settings.write_text(json.dumps(original, indent=2) + "\n")
        self.assertEqual(self.install("status")["installed"], False)

        result = self.install("install")
        self.assertTrue(result["ok"] and result["installed"] and result["working"], result)
        self.assertEqual(result["events"], ["Notification", "PostToolUse", "SessionEnd", "Stop", "UserPromptSubmit"])
        saved = json.loads(self.settings.read_text())
        self.assertEqual(saved["model"], "opus")
        self.assertEqual(saved["hooks"]["Stop"][0], original["hooks"]["Stop"][0])
        self.assertEqual(saved["hooks"]["PreToolUse"], original["hooks"]["PreToolUse"])
        ours = saved["hooks"]["Stop"][1]["hooks"][0]
        self.assertEqual((ours["type"], ours["async"], ours["timeout"]), ("command", True, 10))
        self.assertIn("permission_prompt", saved["hooks"]["Notification"][0]["matcher"])
        self.assertEqual(json.loads((self.home / "settings.json.before-shishi").read_text()), original)

        self.install("install")  # A second install replaces the handlers. It never stacks them.
        self.assertEqual(len(json.loads(self.settings.read_text())["hooks"]["Stop"]), 2)

        self.assertEqual(self.install("remove")["installed"], False)
        self.assertEqual(json.loads(self.settings.read_text()), original)

    def test_installed_command_runs_the_hook(self):
        self.install("install")
        command = json.loads(self.settings.read_text())["hooks"]["Stop"][0]["hooks"][0]["command"]
        event = {"hook_event_name": "Stop", "session_id": "s-9", "cwd": "/tmp/My Project", "last_assistant_message": "Shipped."}
        result = subprocess.run(command, shell=True, input=json.dumps(event), text=True, capture_output=True, env=self.env, timeout=30)
        self.assertEqual((result.returncode, result.stdout), (0, ""), result.stderr)
        self.assertEqual(self.receipts()[0]["title"], "Claude Code · My Project")

    def test_invalid_settings_are_left_alone(self):
        self.home.mkdir()
        self.settings.write_text("{ not json")
        result = self.install("install")
        self.assertFalse(result["ok"])
        self.assertEqual(self.settings.read_text(), "{ not json")

    def test_symlinked_settings_stay_a_symlink(self):
        self.home.mkdir()
        real = self.base / "dotfiles-settings.json"
        real.write_text("{}\n")
        self.settings.symlink_to(real)
        self.install("install")
        self.assertTrue(self.settings.is_symlink())
        self.assertIn("Stop", json.loads(real.read_text())["hooks"])

    def test_remove_without_settings_creates_nothing(self):
        self.assertEqual(self.install("remove")["installed"], False)
        self.assertFalse(self.home.exists())


class AgentStatusCommand(Sandbox):
    def test_set_and_clear(self):
        ok = self.run_script(AGENTS, "set", "--source", "Codex", "--session", "run 1", "--state", "working", "--title", "Nightly\nbuild")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        state, = self.states()
        self.assertEqual((state["title"], state["version"]), ("Nightly build", 1))
        name = hashlib.sha256("Codex\0run 1".encode()).hexdigest() + ".json"
        self.assertTrue((self.base / "Agents" / name).is_file())
        self.assertNotEqual(self.run_script(AGENTS, "set", "--source", "Codex", "--session", "x", "--state", "nope", "--title", "t").returncode, 0)
        self.run_script(AGENTS, "clear", "--source", "Codex", "--session", "run 1")
        self.assertEqual(self.states(), [])


if __name__ == "__main__":
    unittest.main()
