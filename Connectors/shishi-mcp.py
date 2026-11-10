#!/usr/bin/env python3
"""A write-only MCP connector for the local Shishi inbox."""
import argparse
import hmac
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SUPPORTED = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
TOOL = "deliver_result"
MAX_REQUEST = 128 * 1024
SCHEMA = {
    "type": "object",
    "required": ["title", "summary", "event_id"],
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string", "description": "Concise task title."},
        "summary": {"type": "string", "description": "Final result to leave in the user's inbox."},
        "event_id": {"type": "string", "description": "Stable unique identifier for this completed turn. Reuse when retrying."},
        "url": {"type": "string", "description": "Optional original conversation HTTPS URL."},
    },
}

def deliver(source, arguments):
    if not isinstance(arguments, dict) or set(arguments) - set(SCHEMA["properties"]):
        raise ValueError("Unexpected tool arguments.")
    for key in SCHEMA["required"]:
        if not isinstance(arguments.get(key), str) or not arguments[key].strip():
            raise ValueError(f"Missing text field: {key}")
    command = [sys.executable, str(Path(__file__).with_name("shishi-send.py")),
               "--source", source, "--title", arguments["title"], "--event-id", arguments["event_id"]]
    if "url" in arguments:
        if not isinstance(arguments["url"],str):
            raise ValueError("url must be text.")
        command.extend(["--url", arguments["url"]])
    proc = subprocess.run(command, input=arguments["summary"], text=True, capture_output=True, timeout=10)
    if proc.returncode:
        raise ValueError(proc.stderr.strip()[:400] or "Delivery failed.")
    return "Delivered to Shishi."

def dispatch(msg, source):
    identifier = msg.get("id") if isinstance(msg, dict) else None
    def fail(code, message):
        return {"jsonrpc":"2.0", "id":identifier, "error":{"code":code,"message":message}}
    if not isinstance(msg, dict) or msg.get("jsonrpc")!="2.0" or not isinstance(msg.get("method"), str):
        return fail(-32600,"Invalid request")
    if "id" not in msg:
        return None
    method = msg["method"]
    params = msg.get("params", {})
    if not isinstance(params,dict):
        return fail(-32602,"Invalid params")
    if method=="initialize":
        requested = params.get("protocolVersion")
        result = {"protocolVersion":requested if requested in SUPPORTED else SUPPORTED[0],
                  "capabilities":{"tools":{}}, "serverInfo":{"name":"shishi-inbox","version":"1.2"}}
    elif method=="ping":
        result={}
    elif method=="tools/list":
        result={"tools":[{"name":TOOL,"description":"Leave the finished task's result in the user's quiet Shishi inbox.","inputSchema":SCHEMA}]}
    elif method=="tools/call":
        if params.get("name") != TOOL:
            return fail(-32602, "Unknown tool")
        try:
            message=deliver(source,params.get("arguments"))
            result={"content":[{"type":"text","text":message}]}
        except (ValueError,OSError,subprocess.TimeoutExpired) as exc:
            result={"isError":True,"content":[{"type":"text","text":str(exc)}]}
    else:
        return fail(-32601,"Method not found")
    return {"jsonrpc":"2.0","id":identifier,"result":result}

def decode(data,source):
    try:
        return dispatch(json.loads(data),source)
    except (ValueError,UnicodeDecodeError):
        return {"jsonrpc":"2.0","id":None,"error":{"code":-32700,"message":"Parse error"}}

def serve_stdio(source):
    for line in sys.stdin.buffer:
        if len(line)>MAX_REQUEST:
            result={"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"Request too large"}}
        else:
            result=decode(line,source)
        if result is not None:
            print(json.dumps(result,ensure_ascii=False),flush=True)

def serve_http(source, port, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def answer(self,code,body=None):
            payload=b"" if body is None else json.dumps(body,ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Length",str(len(payload)))
            if payload:
                self.send_header("Content-Type","application/json")
            if code==401:
                self.send_header("WWW-Authenticate",'Bearer realm="ShiShi"')
            if code==405:
                self.send_header("Allow","POST")
            self.end_headers()
            self.wfile.write(payload)
        def authorized(self):
            if self.path!="/mcp":
                self.answer(404);return False
            if self.headers.get("Origin") not in (None, f"http://127.0.0.1:{port}"):
                self.answer(403);return False
            auth=self.headers.get("Authorization","").encode()
            if not hmac.compare_digest(auth,("Bearer "+token).encode()):
                self.answer(401);return False
            return True
        def do_GET(self):
            if self.authorized():self.answer(405)
        def do_POST(self):
            if not self.authorized():return
            if self.headers.get_content_type()!="application/json":
                self.answer(415);return
            size=self.headers.get("Content-Length","")
            if not size.isdecimal() or len(size)>8 or int(size)>MAX_REQUEST:
                self.answer(413);return
            version=self.headers.get("MCP-Protocol-Version")
            if version and version not in SUPPORTED:
                self.answer(400);return
            self.connection.settimeout(12)
            data=self.rfile.read(int(size))
            result=decode(data,source)
            self.answer(202 if result is None else 200,result)
    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    print(f"Shishi MCP is listening on http://127.0.0.1:{port}/mcp",file=sys.stderr,flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",required=True,help="Source label for this connector instance, e.g. Grok")
    parser.add_argument("--http",type=int,metavar="PORT",help="Use a bearer-authenticated HTTP endpoint on 127.0.0.1")
    args=parser.parse_args()
    if args.http is None:
        serve_stdio(args.source)
    elif not 1<=args.http<=65535:
        parser.error("Use a port from 1 to 65535.")
    else:
        secret=os.environ.get("SHISHI_MCP_TOKEN","")
        if len(secret)<32:
            parser.error("HTTP mode requires a SHISHI_MCP_TOKEN of at least 32 characters.")
        serve_http(args.source,args.http,secret)
