"""Gemini Flash OCR: image bytes -> verbatim Vietnamese text as structured JSON.

Uses the async client (`client.aio`) with `response_schema` so the SDK parses the
JSON for us (`response.parsed`). Temperature 0 and a strict prompt keep the model
from paraphrasing or summarizing; page numbers / running headers are dropped by
the prompt, not by post-processing, since only the model can tell them apart from
real content.
"""

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from app.pipeline.ocr_provider import OcrError, PageText

GEMINI_TIMEOUT_MS = 120_000  # SDK default is no timeout; a hung call would pin a worker loop

PROMPT = (
    "Trích nguyên văn nội dung chính của trang sách tiếng Việt trong ảnh này. "
    "Giữ nguyên dấu câu, dấu thanh, chính tả gốc — không sửa, không diễn giải, không tóm tắt. "
    "Bỏ số trang, tiêu đề chạy đầu/cuối trang, chú thích lề nếu có. "
    "Nối các dòng bị ngắt giữa chừng trong cùng một đoạn văn thành một dòng liền mạch. "
    "Nếu đoạn văn cuối trang chưa kết thúc (câu còn dang dở, sẽ tiếp tục ở trang sau), "
    "đặt continues_on_next_page = true; ngược lại false. "
    "Trả về paragraphs là danh sách các đoạn văn theo đúng thứ tự xuất hiện."
)


class _OcrSchema(BaseModel):
    paragraphs: list[str]
    continues_on_next_page: bool


class GeminiOcrProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS)) if api_key else None

    async def extract(self, image: bytes, mime: str) -> PageText:
        if self._client is None:
            raise OcrError("Chưa cấu hình gemini", retryable=False)
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[types.Part.from_bytes(data=image, mime_type=mime), PROMPT],
                config=types.GenerateContentConfig(
                    temperature=0,
                    response_mime_type="application/json",
                    response_schema=_OcrSchema,
                ),
            )
        except genai_errors.APIError as exc:
            raise _map_error(exc) from exc
        except (TimeoutError, OSError, httpx.HTTPError) as exc:
            raise OcrError(f"Lỗi mạng khi gọi OCR: {exc}", retryable=True) from exc

        parsed = response.parsed
        if isinstance(parsed, _OcrSchema):
            return PageText(paragraphs=parsed.paragraphs, continues_on_next_page=parsed.continues_on_next_page)
        raise OcrError("Phản hồi OCR không đúng định dạng", retryable=True)


def _map_error(exc: genai_errors.APIError) -> OcrError:
    code = exc.code or 0
    message = exc.message or str(exc)
    if code == 429:
        return OcrError(f"Hết quota OCR tạm thời ({code}): {message}", retryable=True, quota=True)
    if code >= 500:
        return OcrError(f"Lỗi OCR tạm thời ({code}): {message}", retryable=True)
    return OcrError(f"Lỗi OCR: {message}", retryable=False)
