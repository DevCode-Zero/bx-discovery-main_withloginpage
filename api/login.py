"""
Admin login endpoint - validates password.
"""
import os
import json
from http.server import BaseHTTPRequestHandler

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "bxadmin2024")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode()

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._error("Invalid JSON", 400)
            return

        password = data.get("password", "")
        if password == ADMIN_PASSWORD:
            self._json({"success": True, "redirect": "/discovery"})
        else:
            self._error("Incorrect password", 401)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _error(self, message, status):
        self._json({"error": message}, status)
