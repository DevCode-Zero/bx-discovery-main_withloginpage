"""
Health check endpoint - verifies API key is configured.
"""
import os
import json
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        key = os.environ.get("OPENROUTER_API_KEY", "")
        data = {
            "status": "ok",
            "apiKeyLoaded": bool(key and key != "your_api_key_here"),
            "apiKeyPrefix": f"{key[:7]}..." if key else "NOT SET",
        }
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
