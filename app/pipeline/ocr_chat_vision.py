"""OCR through a vision chat model on an OpenAI-compatible API (Cloudflare Workers AI, OpenRouter)
for pages Gemini refuses as recitation.

Uses the same prompt and reply shape as the Gemini provider, so paragraphs are joined,
running headers dropped and `continues_on_next_page` judged by the model, not by rules.
These models do not reliably honour a JSON response format, so the JSON is asked for in
the prompt and read leniently (a ```json fence or stray words around it are ignored).
"""

import base64
import json

import httpx
from pydantic import ValidationError

from app.pipeline.ocr_gemini import PROMPT, OcrReply
from app.pipeline.ocr_http import post_json
from app.pipeline.ocr_provider import OcrError, PageText

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
CLOUDFLARE_URL = "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions"
JSON_INSTRUCTION = (
    ' Chỉ trả về đúng một đối tượng JSON dạng {"paragraphs": ["..."], "continues_on_next_page": false}, '
    "không thêm chữ nào khác."
)
# Some APIs default to a tiny reply budget (Workers AI: 256 tokens), which cuts a dense page mid-JSON.
MAX_OUTPUT_TOKENS = 8192
TRUNCATED_REASON = "length"


class ChatVisionOcrProvider:
    """`name` labels logs and error messages; an empty `api_url`, key or model leaves it unconfigured."""

    def __init__(
        self, name: str, api_url: str, api_key: str, model: str, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.name = name
        self._api_url = api_url
        self._api_key = api_key
        self._model = model
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._api_url and self._api_key and self._model)

    async def extract(self, image: bytes, mime: str) -> PageText:
        if not self.configured:
            raise OcrError(f"Chưa cấu hình {self.name}", retryable=False)
        image_url = f"data:{mime};base64,{base64.b64encode(image).decode('ascii')}"
        body = {
            "model": self._model,
            "temperature": 0,
            "max_tokens": MAX_OUTPUT_TOKENS,
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
        response = await post_json(self._api_url, self._api_key, body, service=self.name, transport=self._transport)
        return _page_text(response, self.name)


def _page_text(response: httpx.Response, service: str) -> PageText:
    try:
        payload = response.json()
    except ValueError as exc:
        raise OcrError(f"Phản hồi {service} không phải JSON", retryable=True) from exc
    # An upstream provider failure can come back as HTTP 200 with an `error` object instead of choices.
    if error := payload.get("error"):
        message = error.get("message") if isinstance(error, dict) else error
        raise OcrError(f"Lỗi {service}: {message}", retryable=True)
    try:
        choice = payload["choices"][0]
        content = choice["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise OcrError(f"Phản hồi {service} thiếu nội dung", retryable=True) from exc
    reply = _parse_reply(content, service, choice.get("finish_reason"))
    return PageText(paragraphs=reply.paragraphs, continues_on_next_page=reply.continues_on_next_page)


def _parse_reply(content: str, service: str, finish_reason: str | None) -> OcrReply:
    # The object spans from the first "{" to the last "}"; anything around it (a code fence, a preamble) is noise.
    start, end = content.find("{"), content.rfind("}")
    text = content[start : end + 1] if 0 <= start < end else content.strip()
    try:
        return OcrReply.model_validate(json.loads(text))
    except (ValueError, ValidationError) as exc:
        # A reply cut at the token limit is cut the same way on a retry at temperature 0.
        raise OcrError(
            f"Phản hồi {service} không đúng định dạng (finish_reason={finish_reason}): {content.strip()[:120]}",
            retryable=finish_reason != TRUNCATED_REASON,
        ) from exc
