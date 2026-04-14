#!/usr/bin/env python3
"""
Local development server - serves both static files and API endpoints.
Run with: python local_server.py
"""
import os
import json
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
import ssl
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE
import urllib.parse

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "bxadmin2024")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-3-haiku"
PORT = 3000


class LocalHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
        elif self.path == "/" or self.path == "/index.html":
            self.serve_file("/public/index.html")
        elif self.path.startswith("/admin"):
            self.serve_file(f"/public{self.path}")
        elif self.path.startswith("/discovery"):
            self.serve_file(f"/public{self.path}")
        else:
            self.serve_file(f"/public{self.path}")

    def do_POST(self):
        if self.path == "/api/login":
            self.handle_login()
        elif self.path == "/api/generate":
            self.handle_generate()
        else:
            self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def handle_api_get(self):
        if self.path == "/api/health":
            key = OPENROUTER_API_KEY
            data = {
                "status": "ok",
                "apiKeyLoaded": bool(key and key != "your_api_key_here"),
                "apiKeyPrefix": f"{key[:7]}..." if key else "NOT SET",
            }
            self.send_json(data)
        else:
            self.send_error(404, "Not Found")

    def handle_login(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        password = data.get("password", "")
        if password == ADMIN_PASSWORD:
            self.send_json({"success": True, "redirect": "/admin"})
        else:
            self.send_json({"error": "Incorrect password"}, 401)

    def handle_generate(self):
        if not OPENROUTER_API_KEY:
            self.send_json({"error": "Missing OPENROUTER_API_KEY"}, 500)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        prompt = data.get("prompt")
        if not prompt:
            self.send_json({"error": "Missing prompt"}, 400)
            return

        app_url = os.environ.get("APP_URL", "https://bx-discovery.vercel.app")

        try:
            request = Request(
                API_URL,
                data=json.dumps({
                    "model": MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 3000,
                    "temperature": 0.7,
                }).encode(),
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "HTTP-Referer": app_url,
                    "X-Title": "BX Discovery App",
                },
                method="POST",
            )
            with urlopen(request, context=ssl_context) as resp:
                response_data = json.loads(resp.read())
            text = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            self.send_json({"content": [{"text": text}]})
        except HTTPError as e:
            try:
                error_data = json.loads(e.read())
                message = error_data.get("error", {}).get("message", "API error")
            except Exception:
                message = "API error"
            self.send_json({"error": message}, e.code)
        except URLError as e:
            self.send_json({"error": f"Network error: {e.reason}"}, 500)
        except Exception as e:
            self.send_json({"error": f"Internal server error: {str(e)}"}, 500)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def serve_file(self, path):
        if path == "/public":
            path = "/public/index.html"
        
        base_path = os.path.join(os.path.dirname(__file__), path.lstrip("/"))
        
        if not os.path.exists(base_path):
            self.send_error(404, "File not found")
            return

        if os.path.isdir(base_path):
            index_path = os.path.join(base_path, "index.html")
            if os.path.exists(index_path):
                filepath = index_path
            else:
                self.send_error(403, "Directory listing not allowed")
                return
        else:
            filepath = base_path

        mime_type, _ = mimetypes.guess_type(filepath)
        if mime_type is None:
            mime_type = "application/octet-stream"

        with open(filepath, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    server = HTTPServer(("localhost", PORT), LocalHandler)
    print(f"Local server running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
