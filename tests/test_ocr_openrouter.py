"""OpenRouter vision-model fallback (REST mocked with httpx.MockTransport) and the recitation routing."""

import base64
import json

import httpx
import pytest

from app.pipeline.ocr_fallback import RecitationFallbackOcrProvider
from app.pipeline.ocr_openrouter import OpenRouterOcrProvider
from app.pipeline.ocr_provider import OcrError, PageText

MODEL = "qwen/qwen2.5-vl-72b-instruct:free"


def _provider(handler) -> OpenRouterOcrProvider:
    return OpenRouterOcrProvider("test-key", MODEL, transport=httpx.MockTransport(handler))


def _answer(content: str):
    return lambda _request: httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


async def _extract_error(handler) -> OcrError:
    with pytest.raises(OcrError) as caught:
        await _provider(handler).extract(b"img", "image/jpeg")
    return caught.value


async def test_sends_the_page_as_a_data_url_with_the_shared_prompt() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _answer('{"paragraphs": ["Điều 1."], "continues_on_next_page": false}')(request)

    page = await _provider(handler).extract(b"jpeg-bytes", "image/jpeg")

    assert page == PageText(paragraphs=["Điều 1."], continues_on_next_page=False)
    request = seen[0]
    assert request.headers["Authorization"] == "Bearer test-key"
    body = json.loads(request.content)
    assert body["model"] == MODEL
    assert body["temperature"] == 0
    text_part, image_part = body["messages"][0]["content"]
    assert "Trích nguyên văn" in text_part["text"]
    assert "continues_on_next_page" in text_part["text"]
    assert image_part["image_url"]["url"] == "data:image/jpeg;base64," + base64.b64encode(b"jpeg-bytes").decode()


async def test_accepts_json_wrapped_in_a_markdown_fence() -> None:
    fenced = '```json\n{"paragraphs": ["Luật này quy định", "về đầu tư công."], "continues_on_next_page": true}\n```'

    page = await _provider(_answer(fenced)).extract(b"img", "image/jpeg")

    assert page.paragraphs == ["Luật này quy định", "về đầu tư công."]
    assert page.continues_on_next_page is True


async def test_non_json_reply_is_retryable() -> None:
    error = await _extract_error(_answer("Xin lỗi, tôi không đọc được ảnh này."))

    assert error.message.startswith("Phản hồi OpenRouter không đúng định dạng")
    assert error.retryable is True


async def test_upstream_error_inside_a_200_is_retryable() -> None:
    error = await _extract_error(lambda _r: httpx.Response(200, json={"error": {"message": "Provider returned error"}}))

    assert error.message == "Lỗi OpenRouter: Provider returned error"
    assert error.retryable is True


@pytest.mark.parametrize(
    ("status", "retryable", "quota"),
    [(429, True, True), (502, True, False), (401, False, False), (404, False, False)],
)
async def test_http_errors_map_to_retry_policy(status: int, retryable: bool, quota: bool) -> None:
    error = await _extract_error(lambda _r: httpx.Response(status, text="nope"))

    assert (error.retryable, error.quota) == (retryable, quota)


async def test_unconfigured_provider_fails_without_calling_openrouter() -> None:
    provider = OpenRouterOcrProvider("", MODEL)

    assert provider.configured is False
    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")
    assert caught.value.retryable is False


class _ScriptedOcr:
    def __init__(self, outcome: PageText | OcrError) -> None:
        self.outcome = outcome
        self.calls = 0

    async def extract(self, image: bytes, mime: str) -> PageText:
        self.calls += 1
        if isinstance(self.outcome, OcrError):
            raise self.outcome
        return self.outcome


FALLBACK_TEXT = PageText(paragraphs=["Đọc bởi model dự phòng."], continues_on_next_page=False)


async def test_recitation_block_is_read_by_the_fallback() -> None:
    primary = _ScriptedOcr(OcrError("RECITATION", retryable=False, recitation=True))
    fallback = _ScriptedOcr(FALLBACK_TEXT)

    page = await RecitationFallbackOcrProvider(primary, fallback).extract(b"img", "image/jpeg")

    assert page == FALLBACK_TEXT
    assert (primary.calls, fallback.calls) == (1, 1)


async def test_other_primary_errors_do_not_touch_the_fallback() -> None:
    primary = _ScriptedOcr(OcrError("503", retryable=True))
    fallback = _ScriptedOcr(FALLBACK_TEXT)

    with pytest.raises(OcrError):
        await RecitationFallbackOcrProvider(primary, fallback).extract(b"img", "image/jpeg")

    assert fallback.calls == 0
