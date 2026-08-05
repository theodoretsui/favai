"""Minimal OpenAI-compatible streaming server for browser E2E tests."""

from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.rstrip("/") != "/models":
            self.send_error(404)
            return
        body = json.dumps(
            {
                "data": [
                    {"id": "e2e-vision-model"},
                    {"id": "e2e-text-model"},
                ]
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        messages = payload.get("messages", [])
        is_tool_bubble_test = any(
            "E2E_TOOL_RESULT_BUBBLE" in _message_text(message) for message in messages
        )
        is_proposal_warning_test = any(
            "E2E_PROPOSAL_WARNING" in _message_text(message) for message in messages
        )
        tool_results = [
            message for message in messages if message.get("role") == "tool"
        ]

        if is_tool_bubble_test:
            expected_ids = ["e2e-today-call-1", "e2e-today-call-2"]
            actual_ids = [message.get("tool_call_id") for message in tool_results]
            if actual_ids != expected_ids[: len(actual_ids)]:
                self.send_error(400, "unexpected tool_call_id sequence")
                return
            self._start_stream()
            if len(tool_results) == 0:
                self._chunk({"role": "assistant", "content": ""})
                self._chunk({"reasoning_content": "第一步思考。"})
                self._chunk(
                    {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "e2e-today-call-1",
                                "type": "function",
                                "function": {"name": "today", "arguments": "{}"},
                            }
                        ]
                    }
                )
                self._chunk({}, finish_reason="tool_calls")
            elif len(tool_results) == 1:
                self._chunk({"role": "assistant", "content": ""})
                self._chunk({"reasoning_content": "第二步思考。"})
                self._chunk({"content": "中间输出。"})
                self._chunk(
                    {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "e2e-today-call-2",
                                "type": "function",
                                "function": {"name": "today", "arguments": "{}"},
                            }
                        ]
                    }
                )
                self._chunk({}, finish_reason="tool_calls")
            else:
                self._chunk({"role": "assistant", "content": ""})
                self._chunk({"reasoning_content": "第三步思考。"})
                self._chunk({"content": "最终输出。"})
                self._chunk({}, finish_reason="stop")
            self.wfile.write(b"data: [DONE]\n\n")
            return

        if is_proposal_warning_test:
            self._start_stream()
            self._chunk({"role": "assistant", "content": ""})
            if not tool_results:
                arguments = json.dumps(
                    {
                        "transactions": [
                            {
                                "date": "2026-08-05",
                                "flag": "incomplete",
                                "payee": "待确认商户",
                                "narration": "待确认消费",
                                "postings": [
                                    {
                                        "account": "Expenses:Test",
                                        "amount": "12.34",
                                        "currency": "CNY",
                                    },
                                    {"account": "Assets:Cash", "currency": "CNY"},
                                ],
                            }
                        ]
                    },
                    ensure_ascii=False,
                )
                self._chunk(
                    {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "e2e-proposal-warning-call",
                                "type": "function",
                                "function": {
                                    "name": "propose_transactions",
                                    "arguments": arguments,
                                },
                            }
                        ]
                    }
                )
                self._chunk({}, finish_reason="tool_calls")
            else:
                self._chunk({"content": "待确认提案已提交。"})
                self._chunk({}, finish_reason="stop")
            self.wfile.write(b"data: [DONE]\n\n")
            return

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

        self._start_stream()
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

    def _start_stream(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8891)
    args = parser.parse_args()
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
