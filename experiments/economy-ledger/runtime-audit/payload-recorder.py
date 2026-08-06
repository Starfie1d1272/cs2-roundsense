#!/usr/bin/env python3
"""Raw GSI payload recorder for the loss-counter audit (Windows box).

Writes one JSON object per line to payloads.ndjson, timestamped with
receive time. NEVER stores auth tokens (strips them).

Run: python payload-recorder.py [port] [outfile]
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1337
OUT = sys.argv[2] if len(sys.argv) > 2 else "payloads.ndjson"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            data = json.loads(body)
        except Exception:
            self.send_response(400)
            self.end_headers()
            return
        data.pop("auth", None)  # never persist credentials
        line = json.dumps(
            {"t_recv": time.time(), "payload": data}, separators=(",", ":")
        )
        with open(OUT, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        self.send_response(200)
        self.end_headers()

    def log_message(self, format: str, *args):  # noqa: A002 - silence access logs
        pass


if __name__ == "__main__":
    print(f"listening :{PORT} → {OUT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
