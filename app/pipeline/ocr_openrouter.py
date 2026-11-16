"""OCR through a vision model on OpenRouter (default: Qwen2.5-VL, free tier) for pages Gemini refuses as recitation.

Uses the same prompt and reply shape as the Gemini provider, so paragraphs are joined,
running headers dropped and `continues_on_next_page` judged by the model, not by rules.
Free models do not reliably honour a JSON response format, so the JSON is asked for in
the prompt and read leniently (a ```json fence around it is accepted).
"""

import base64
import json
import re

import httpx
from pydantic import ValidationError

from app.pipeline.ocr_gemini import PROMPT, OcrReply
from app.pipeline.ocr_provider import OcrError, PageText

API_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_SECONDS = 120.0
JSON_INSTRUCTION = (
    ' Chỉ trả về đúng một đối tượng JSON dạng {"paragraphs": ["..."], "continues_on_next_page": false}, '
    "không thêm chữ nào khác."
)
_JSON_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


class OpenRouterOcrProvider:
    name = "openrouter"

    def __init__(self, api_key: str, model: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._api_key and self._model)

    async def extract(self, image: bytes, mime: str) -> PageText:
        if not self.configured:
            raise OcrError("Chưa cấu hình OpenRouter", retryable=False)
        image_url = f"data:{mime};base64,{base64.b64encode(image).decode('ascii')}"
        body = {
            "model": self._model,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT + JSON_INSTRUCTION},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "User-Agent": "booksnap"}
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=self._transport) as client:
                response = await client.post(API_URL, headers=headers, json=body)
        except httpx.HTTPError as exc:
            raise OcrError(f"Lỗi mạng khi gọi OpenRouter: {exc}", retryable=True) from exc
        _raise_for_status(response)
        return _page_text(response)


def _raise_for_status(response: httpx.Response) -> None:
    code = response.status_code
    if code < 400:
        return
    if code == 429:
        raise OcrError("Hết quota OpenRouter tạm thời (429)", retryable=True, quota=True)
    if code >= 500:
        raise OcrError(f"Lỗi OpenRouter tạm thời ({code})", retryable=True)
    raise OcrError(f"Lỗi OpenRouter ({code}): {response.text[:200]}", retryable=False)


def _page_text(response: httpx.Response) -> PageText:
    try:
        payload = response.json()
    except ValueError as exc:
        raise OcrError("Phản hồi OpenRouter không phải JSON", retryable=True) from exc
    # An upstream provider failure can come back as HTTP 200 with an `error` object instead of choices.
    if error := payload.get("error"):
        message = error.get("message") if isinstance(error, dict) else error
        raise OcrError(f"Lỗi OpenRouter: {message}", retryable=True)
    try:
        content = payload["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise OcrError("Phản hồi OpenRouter thiếu nội dung", retryable=True) from exc
    reply = _parse_reply(content)
    return PageText(paragraphs=reply.paragraphs, continues_on_next_page=reply.continues_on_next_page)


def _parse_reply(content: str) -> OcrReply:
    text = content.strip()
    if fenced := _JSON_FENCE.match(text):
        text = fenced.group(1)
    try:
        return OcrReply.model_validate(json.loads(text))
    except (ValueError, ValidationError) as exc:
        raise OcrError(f"Phản hồi OpenRouter không đúng định dạng: {text[:120]}", retryable=True) from exc
