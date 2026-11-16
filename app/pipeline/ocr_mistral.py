"""OCR through Mistral OCR (`/v1/ocr`) for pages Gemini refuses as recitation.

Mistral OCR is a plain OCR model: it returns the page as Markdown and takes no prompt.
Running headers and footers are split out by the API (`extract_header`/`extract_footer`),
so only the body is kept; the Markdown is turned into paragraphs here and
`continues_on_next_page` is judged from how the last paragraph ends.
"""

import base64
import re

import httpx

from app.pipeline.ocr_http import post_json
from app.pipeline.ocr_provider import OcrError, PageText

API_URL = "https://api.mistral.ai/v1/ocr"
SERVICE = "Mistral"
# A paragraph ending in one of these closes its sentence; anything else runs on to the next page.
_SENTENCE_END = ".!?…:;\"'”’»)]"
_IMAGE_PLACEHOLDER = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_BLANK_LINES = re.compile(r"\n\s*\n")
_HEADING_MARK = re.compile(r"^#{1,6}\s+")
_EMPHASIS = re.compile(r"\*{1,3}|_{2,3}")


class MistralOcrProvider:
    name = "mistral"

    def __init__(self, api_key: str, model: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._api_key and self._model)

    async def extract(self, image: bytes, mime: str) -> PageText:
        if not self.configured:
            raise OcrError("Chưa cấu hình Mistral", retryable=False)
        body = {
            "model": self._model,
            "document": {
                "type": "image_url",
                "image_url": f"data:{mime};base64,{base64.b64encode(image).decode('ascii')}",
            },
            "extract_header": True,
            "extract_footer": True,
        }
        response = await post_json(API_URL, self._api_key, body, service=SERVICE, transport=self._transport)
        return markdown_to_page_text(_page_markdown(response))


def _page_markdown(response: httpx.Response) -> str:
    try:
        pages = response.json()["pages"]
        return "\n\n".join(page.get("markdown") or "" for page in pages)
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise OcrError("Phản hồi Mistral thiếu nội dung trang", retryable=True) from exc


def markdown_to_page_text(markdown: str) -> PageText:
    """Turn OCR Markdown into reading paragraphs: one per blank-line block, line breaks joined, markup dropped."""
    text = _IMAGE_PLACEHOLDER.sub("", markdown)
    paragraphs = [_plain_paragraph(block) for block in _BLANK_LINES.split(text)]
    paragraphs = [p for p in paragraphs if p]
    continues = bool(paragraphs) and not paragraphs[-1].endswith(tuple(_SENTENCE_END))
    return PageText(paragraphs=paragraphs, continues_on_next_page=continues)


def _plain_paragraph(block: str) -> str:
    lines = (_HEADING_MARK.sub("", line.strip()) for line in block.splitlines())
    return _EMPHASIS.sub("", " ".join(line for line in lines if line)).strip()
