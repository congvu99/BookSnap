"""Mistral OCR fallback (REST mocked with httpx.MockTransport) and its Markdown-to-paragraph conversion."""

import base64
import json

import httpx
import pytest

from app.pipeline.ocr_mistral import MistralOcrProvider, markdown_to_page_text
from app.pipeline.ocr_provider import OcrError, PageText

MODEL = "mistral-ocr-latest"


def _provider(handler) -> MistralOcrProvider:
    return MistralOcrProvider("test-key", MODEL, transport=httpx.MockTransport(handler))


def _pages(*markdowns: str):
    pages = [{"index": i, "markdown": md} for i, md in enumerate(markdowns)]
    return lambda _request: httpx.Response(200, json={"pages": pages, "model": MODEL})


async def test_sends_the_page_as_a_data_url_and_splits_out_headers() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _pages("Điều 1. Phạm vi điều chỉnh.")(request)

    page = await _provider(handler).extract(b"jpeg-bytes", "image/jpeg")

    assert page == PageText(paragraphs=["Điều 1. Phạm vi điều chỉnh."], continues_on_next_page=False)
    request = seen[0]
    assert request.url == httpx.URL("https://api.mistral.ai/v1/ocr")
    assert request.headers["Authorization"] == "Bearer test-key"
    body = json.loads(request.content)
    assert body["model"] == MODEL
    assert body["document"] == {
        "type": "image_url",
        "image_url": "data:image/jpeg;base64," + base64.b64encode(b"jpeg-bytes").decode(),
    }
    assert body["extract_header"] is True
    assert body["extract_footer"] is True


def test_markdown_becomes_reading_paragraphs() -> None:
    markdown = (
        "# CHƯƠNG I\n\n"
        "Luật này quy định về\nquản lý **đầu tư công**.\n\n"
        "![img-0.jpeg](img-0.jpeg)\n\n"
        "Nhà nước khuyến khích"
    )

    page = markdown_to_page_text(markdown)

    assert page.paragraphs == ["CHƯƠNG I", "Luật này quy định về quản lý đầu tư công.", "Nhà nước khuyến khích"]
    assert page.continues_on_next_page is True


@pytest.mark.parametrize("ending", ["kết thúc.", "câu hỏi?", "liệt kê:", "trích dẫn.”"])
def test_a_closed_sentence_does_not_continue(ending: str) -> None:
    assert markdown_to_page_text(f"Một đoạn {ending}").continues_on_next_page is False


def test_empty_page_has_no_paragraphs() -> None:
    assert markdown_to_page_text("\n\n") == PageText(paragraphs=[], continues_on_next_page=False)


async def test_reply_without_pages_is_retryable() -> None:
    with pytest.raises(OcrError) as caught:
        await _provider(lambda _r: httpx.Response(200, json={"detail": "x"})).extract(b"img", "image/jpeg")

    assert caught.value.retryable is True


@pytest.mark.parametrize(
    ("status", "retryable", "quota"),
    [(429, True, True), (503, True, False), (401, False, False), (422, False, False)],
)
async def test_http_errors_map_to_retry_policy(status: int, retryable: bool, quota: bool) -> None:
    with pytest.raises(OcrError) as caught:
        await _provider(lambda _r: httpx.Response(status, text="nope")).extract(b"img", "image/jpeg")

    assert (caught.value.retryable, caught.value.quota) == (retryable, quota)
    assert "Mistral" in caught.value.message


async def test_unconfigured_provider_fails_without_calling_mistral() -> None:
    provider = MistralOcrProvider("", MODEL)

    assert provider.configured is False
    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")
    assert caught.value.retryable is False
