"""Reject oversized request bodies before routing, i.e. before multipart parsing and auth.

FastAPI parses form bodies before dependencies run, so without this an anonymous client
could stream an unbounded upload to disk/RAM and only then receive 401.
"""

import json

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MESSAGE = "Dữ liệu gửi lên quá lớn"


class _BodyTooLarge(HTTPException):
    """An HTTPException so FastAPI's body parser re-raises it instead of turning it into a 400."""

    def __init__(self) -> None:
        super().__init__(413, MESSAGE)


class RequestSizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_body_bytes:
            await self._reject(send)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise _BodyTooLarge()
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not response_started:
                await self._reject(send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = json.dumps(
            {"error": {"code": "request_too_large", "message": MESSAGE, "field": None}}, ensure_ascii=False
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})
