"""Minimal OpenAI-compatible streaming server for browser E2E tests."""

from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        messages = payload.get("messages", [])
        has_image = any(
            isinstance(message.get("content"), list)
            and any(block.get("type") == "image_url" for block in message["content"])
            for message in messages
        )
        if not has_image:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"missing image_url"}}')
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self._chunk({"role": "assistant", "content": ""})
        self._chunk({"content": "图片已处理。"})
        self._chunk({}, finish_reason="stop")
        self.wfile.write(b"data: [DONE]\n\n")

    def _chunk(
        self, delta: dict[str, Any], *, finish_reason: str | None = None
    ) -> None:
        body = {
            "id": "e2e-completion",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "e2e-vision-model",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        self.wfile.write(f"data: {json.dumps(body)}\n\n".encode())
        self.wfile.flush()

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8891)
    args = parser.parse_args()
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
