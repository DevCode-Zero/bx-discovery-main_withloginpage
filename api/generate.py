"""
AI generation endpoint - sends prompt to OpenRouter API.
"""
import os
import json
from http.server import BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-3-haiku"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            self._error("Missing OPENROUTER_API_KEY", 500)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode()

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._error("Invalid JSON", 400)
            return

        prompt = data.get("prompt")
        if not prompt:
            self._error("Missing prompt", 400)
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
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": app_url,
                    "X-Title": "BX Discovery App",
                },
                method="POST",
            )

            with urlopen(request) as resp:
                response_data = json.loads(resp.read())

            text = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            self._json({"content": [{"text": text}]})

        except HTTPError as e:
            try:
                error_data = json.loads(e.read())
                message = error_data.get("error", {}).get("message", "API error")
            except Exception:
                message = "API error"
            self._error(message, e.code)

        except URLError as e:
            self._error(f"Network error: {e.reason}", 500)

        except Exception as e:
            self._error(f"Internal server error: {str(e)}", 500)

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
