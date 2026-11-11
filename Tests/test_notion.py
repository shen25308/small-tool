"""Exercise Mail/notion.py against a local stand-in for the Notion API."""
import importlib.util
import io
import json
import sys
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("shishi_notion", ROOT / "Mail" / "notion.py")
notion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notion)

TOKEN = "ntn_" + "x" * 40
DB = "11111111-2222-3333-4444-555555555555"
STATUS_DB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def rich(text):
    return [{"type": "text", "plain_text": text, "text": {"content": text}}]


class FakeNotion:
    def __init__(self):
        self.requests = []
        self.fail_next = []
        self.pages = {}
        self.counter = 0
        self.schemas = {
            DB: {"Name": {"type": "title"}, "Done": {"type": "checkbox"}, "Due": {"type": "date"},
                 "Priority": {"type": "select", "select": {"options": [{"name": "High"}, {"name": "Medium"}, {"name": "Low"}]}},
                 "Tags": {"type": "multi_select"}, "Notes": {"type": "rich_text"}},
            STATUS_DB: {"Task": {"type": "title"}, "Created": {"type": "date"}, "Status": {"type": "status", "status": {
                "options": [{"id": "o1", "name": "Not started"}, {"id": "o2", "name": "In progress"}, {"id": "o3", "name": "Done"}],
                "groups": [{"name": "To-do", "option_ids": ["o1"]}, {"name": "In progress", "option_ids": ["o2"]},
                           {"name": "Complete", "option_ids": ["o3"]}]}}},
        }

    def add(self, database, title, **properties):
        self.counter += 1
        identifier = f"00000000-0000-0000-0000-{self.counter:012d}"
        name = "Name" if database == DB else "Task"
        self.pages[identifier] = {"object": "page", "id": identifier, "archived": False, "parent": database,
                                  "url": "https://www.notion.so/" + identifier.replace("-", ""),
                                  "last_edited_time": f"2026-11-11T10:00:{self.counter:02d}.000Z",
                                  "properties": {name: {"type": "title", "title": rich(title)}, **properties}}
        return identifier

    def handle(self, method, path, headers, body):
        self.requests.append((method, path, body))
        if headers.get("Authorization") != "Bearer " + TOKEN or headers.get("Notion-Version") != "2022-06-28":
            return 401, {"object": "error", "code": "unauthorized"}
        if self.fail_next:
            return self.fail_next.pop(0), {"object": "error"}
        parts = path.strip("/").split("/")
        if parts[:2] == ["v1", "databases"] and parts[2] in self.schemas:
            if method == "GET" and len(parts) == 3:
                return 200, {"object": "database", "id": parts[2], "title": rich("Team tasks"),
                             "url": "https://www.notion.so/" + parts[2].replace("-", ""), "properties": self.schemas[parts[2]]}
            if method == "POST" and parts[3:] == ["query"]:
                rows = [p for p in self.pages.values() if p["parent"] == parts[2]]
                start = int(body.get("start_cursor") or 0)
                size = min(body.get("page_size", 100), 2)
                more = start + size < len(rows)
                return 200, {"results": rows[start:start + size], "has_more": more, "next_cursor": str(start + size) if more else None}
        if parts[:2] == ["v1", "pages"]:
            if method == "POST" and len(parts) == 2:
                identifier = self.add(body["parent"]["database_id"], "")
                self.pages[identifier]["properties"] = {}
            elif method == "PATCH" and parts[2] in self.pages:
                identifier = parts[2]
            else:
                return 404, {"object": "error"}
            page = self.pages[identifier]
            for name, value in body["properties"].items():
                kind = next(iter(value))
                page["properties"][name] = {"type": kind, **value}
                if kind == "title":
                    page["properties"][name]["title"] = rich(value["title"][0]["text"]["content"])
            page["last_edited_time"] = "2026-11-11T12:00:00.000Z"
            return 200, page
        return 404, {"object": "error", "code": "object_not_found"}


class NotionSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeNotion()
        fake = cls.fake

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def respond(self):
                size = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(size)) if size else None
                code, payload = fake.handle(self.command, self.path, self.headers, body)
                data = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Length", str(len(data)))
                if code == 429:
                    self.send_header("Retry-After", "0")
                self.end_headers()
                self.wfile.write(data)
            do_GET = do_POST = do_PATCH = respond

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        notion.API = f"http://127.0.0.1:{cls.server.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.fake.pages.clear()
        self.fake.requests.clear()
        self.fake.fail_next.clear()

    def run_op(self, **request):
        stdin, sys.stdin = sys.stdin, io.TextIOWrapper(io.BytesIO(json.dumps({"token": TOKEN, **request}).encode()))
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                code = notion.main()
        finally:
            sys.stdin = stdin
        return code, json.loads(out.getvalue())

    def test_database_id_forms(self):
        plain = DB.replace("-", "")
        for value in (DB, plain, f"https://www.notion.so/acme/Team-tasks-{plain}?v={'9' * 32}", f"https://www.notion.so/{plain}"):
            self.assertEqual(notion.database_id(value), DB)
        with self.assertRaises(notion.NotionError):
            notion.database_id("https://www.notion.so/acme/Team-tasks")

    def test_connect_maps_checkbox_columns(self):
        code, result = self.run_op(op="connect", database=DB)
        self.assertEqual(code, 0, result)
        self.assertEqual(result["title"], "Team tasks")
        self.assertEqual(result["mapping"], {
            "title": "Name", "done": {"name": "Done", "type": "checkbox"}, "due": "Due",
            "priority": {"name": "Priority", "options": ["High", "Medium", "Low"]},
            "tag": {"name": "Tags", "type": "multi_select"}})

    def test_connect_maps_status_column(self):
        _, result = self.run_op(op="connect", database=STATUS_DB)
        self.assertEqual(result["mapping"], {"title": "Task", "due": "Created",
                                             "done": {"name": "Status", "type": "status", "complete": ["Done"], "open": "Not started"}})

    def test_pull_reads_every_page(self):
        self.fake.add(DB, "Write spec", Done={"type": "checkbox", "checkbox": True},
                      Due={"type": "date", "date": {"start": "2026-11-12T15:00:00.000+08:00"}},
                      Priority={"type": "select", "select": {"name": "High"}},
                      Tags={"type": "multi_select", "multi_select": [{"name": "Design"}, {"name": "Q4"}]})
        self.fake.add(DB, "Plain row")
        gone = self.fake.add(DB, "Archived row")
        self.fake.pages[gone]["archived"] = True
        self.fake.add(DB, "Fourth row", Due={"type": "date", "date": None})
        code, result = self.run_op(op="pull", database=DB)
        self.assertEqual(code, 0, result)
        self.assertEqual([p["title"] for p in result["pages"]], ["Write spec", "Plain row", "Fourth row"])
        first = result["pages"][0]
        self.assertEqual((first["done"], first["due"], first["priority"], first["tag"]),
                         (True, "2026-11-12T15:00:00.000+08:00", "P0", "Design"))
        self.assertEqual((result["pages"][1]["done"], result["pages"][1]["due"], result["pages"][1]["priority"]), (False, "", ""))
        self.assertEqual(sum(1 for r in self.fake.requests if r[1].endswith("/query")), 2)

    def test_push_creates_and_updates(self):
        existing = self.fake.add(DB, "Old title")
        _, pulled = self.run_op(op="pull", database=DB)
        code, result = self.run_op(op="push", database=DB, mapping=pulled["mapping"], changes=[
            {"task": "t-new", "page": "", "fields": {"title": "Ship 2.0", "done": False, "due": "2026-11-20", "priority": "P1", "tag": "Release"}},
            {"task": "t-old", "page": existing, "fields": {"done": True, "due": "", "priority": ""}},
            {"task": "t-missing", "page": "99999999-0000-0000-0000-000000000000", "fields": {"done": True}},
        ])
        self.assertEqual(code, 0, result)
        created, updated, missing = result["results"]
        self.assertTrue(created["ok"] and updated["ok"])
        self.assertEqual((created["page"]["title"], created["page"]["due"], created["page"]["priority"], created["page"]["tag"]),
                         ("Ship 2.0", "2026-11-20", "P1", "Release"))
        new_page = self.fake.pages[created["page"]["id"]]["properties"]
        self.assertEqual(new_page["Priority"]["select"], {"name": "Medium"})
        self.assertEqual(new_page["Done"]["checkbox"], False)
        old_page = self.fake.pages[existing]["properties"]
        self.assertEqual((old_page["Done"]["checkbox"], old_page["Due"]["date"], old_page["Priority"]["select"]), (True, None, None))
        self.assertEqual(updated["page"]["title"], "Old title")
        self.assertFalse(missing["ok"])
        self.assertIn("could not find", missing["error"])

    def test_push_status_column(self):
        page = self.fake.add(STATUS_DB, "Review", Status={"type": "status", "status": {"name": "In progress"}})
        _, pulled = self.run_op(op="pull", database=STATUS_DB)
        self.assertFalse(pulled["pages"][0]["done"])
        _, result = self.run_op(op="push", database=STATUS_DB, mapping=pulled["mapping"],
                                changes=[{"task": "t", "page": page, "fields": {"done": True}}])
        self.assertTrue(result["results"][0]["page"]["done"])
        self.assertEqual(self.fake.pages[page]["properties"]["Status"]["status"], {"name": "Done"})

    def test_errors_are_plain_and_rate_limits_retry(self):
        code, result = self.run_op(op="pull", database=DB, token="wrong-secret-that-is-long-enough")
        self.assertEqual((code, result["ok"]), (1, False))
        self.assertIn("rejected the integration secret", result["error"])
        self.assertNotRegex(result["error"], r"https?://|token[=:]")
        self.fake.fail_next.extend([429, 503])
        code, result = self.run_op(op="connect", database=DB)
        self.assertEqual(code, 0, result)
        code, result = self.run_op(op="connect", database="ffffffff-ffff-ffff-ffff-ffffffffffff")
        self.assertIn("Connections", result["error"])
        code, result = self.run_op(op="pull", database=DB, token="short")
        self.assertEqual(result["error"], "Connect Notion first.")


if __name__ == "__main__":
    unittest.main()
