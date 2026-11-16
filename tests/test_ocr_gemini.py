"""GeminiOcrProvider: unparseable replies say why Gemini stopped; a recitation block retries the page in two halves."""

import json
from io import BytesIO
from types import SimpleNamespace

import pytest
from google.genai import types
from PIL import Image, ImageDraw

from app.pipeline.ocr_gemini import RECITATION_MESSAGE, GeminiOcrProvider, _OcrSchema
from app.pipeline.ocr_provider import OcrError
from app.pipeline.page_image_split import split_page_horizontally


def _reply(paragraphs: list[str], continues: bool) -> types.GenerateContentResponse:
    """A successful reply as the SDK hands it back: raw JSON text plus the schema it already parsed."""
    body = {"paragraphs": paragraphs, "continues_on_next_page": continues}
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(role="model", parts=[types.Part(text=json.dumps(body))]),
                finish_reason=types.FinishReason.STOP,
            )
        ],
        parsed=_OcrSchema(**body),
    )


def _recitation() -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(finish_reason=types.FinishReason.RECITATION)])


def _scripted_provider(*replies: types.GenerateContentResponse) -> tuple[GeminiOcrProvider, list[dict]]:
    """Provider whose Gemini client returns `replies` in order and records each call's arguments."""
    pending = list(replies)
    calls: list[dict] = []

    async def generate_content(**kwargs: object) -> types.GenerateContentResponse:
        calls.append(kwargs)
        return pending.pop(0)

    provider = GeminiOcrProvider(api_key="", model="test-model")
    provider._client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return provider, calls


def _page_photo() -> bytes:
    """White page with two black text blocks separated by a blank gap at rows 95-105."""
    page = Image.new("RGB", (100, 200), "white")
    draw = ImageDraw.Draw(page)
    draw.rectangle((10, 20, 90, 94), fill="black")
    draw.rectangle((10, 106, 90, 180), fill="black")
    buffer = BytesIO()
    page.save(buffer, format="JPEG")
    return buffer.getvalue()


def _sent_image(call: dict) -> Image.Image:
    part = call["contents"][0]
    return Image.open(BytesIO(part.inline_data.data))


async def test_unparseable_reply_reports_finish_reason_and_token_usage() -> None:
    response = types.GenerateContentResponse(
        candidates=[types.Candidate(finish_reason=types.FinishReason.MAX_TOKENS)],
        usage_metadata=types.GenerateContentResponseUsageMetadata(candidates_token_count=0, thoughts_token_count=812),
    )
    provider, _ = _scripted_provider(response)

    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")

    assert caught.value.message == (
        "Phản hồi OCR không đúng định dạng (finish_reason=MAX_TOKENS, output_tokens=0, thinking_tokens=812)"
    )
    assert caught.value.retryable is True


async def test_blocked_prompt_reports_block_reason() -> None:
    response = types.GenerateContentResponse(
        prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=types.BlockedReason.SAFETY),
    )
    provider, _ = _scripted_provider(response)

    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")

    assert caught.value.message == "Phản hồi OCR không đúng định dạng (block_reason=SAFETY)"


async def test_reply_without_any_metadata_keeps_the_plain_message() -> None:
    provider, _ = _scripted_provider(types.GenerateContentResponse())

    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")

    assert caught.value.message == "Phản hồi OCR không đúng định dạng"


async def test_recitation_block_reads_the_page_in_two_halves_and_joins_the_cut_paragraph() -> None:
    provider, calls = _scripted_provider(
        _recitation(),
        _reply(["Điều 1. Phạm vi", "Luật này quy định"], continues=True),
        _reply(["về đầu tư công.", "Điều 2."], continues=False),
    )

    page = await provider.extract(_page_photo(), "image/jpeg")

    assert page.paragraphs == ["Điều 1. Phạm vi", "Luật này quy định về đầu tư công.", "Điều 2."]
    assert page.continues_on_next_page is False
    top, bottom = _sent_image(calls[1]), _sent_image(calls[2])
    assert (top.width, bottom.width) == (100, 100)
    assert top.height + bottom.height == 200


async def test_recitation_in_a_half_fails_the_page_without_worker_retries() -> None:
    provider, calls = _scripted_provider(_recitation(), _reply(["Nửa trên"], continues=False), _recitation())

    with pytest.raises(OcrError) as caught:
        await provider.extract(_page_photo(), "image/jpeg")

    assert caught.value.message == RECITATION_MESSAGE
    assert caught.value.retryable is False
    assert len(calls) == 3


async def test_recitation_on_an_undecodable_image_fails_without_calling_gemini_again() -> None:
    provider, calls = _scripted_provider(_recitation())

    with pytest.raises(OcrError) as caught:
        await provider.extract(b"not an image", "image/jpeg")

    assert caught.value.message == RECITATION_MESSAGE
    assert len(calls) == 1


def test_split_cuts_on_the_blank_gap_between_text_blocks() -> None:
    halves = split_page_horizontally(_page_photo())

    assert halves is not None
    top_height = Image.open(BytesIO(halves[0])).height
    assert 95 <= top_height <= 106


def test_split_honours_exif_rotation() -> None:
    sideways = Image.new("RGB", (200, 100), "white")
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° CW to display
    buffer = BytesIO()
    sideways.save(buffer, format="JPEG", exif=exif)

    halves = split_page_horizontally(buffer.getvalue())

    assert halves is not None
    top = Image.open(BytesIO(halves[0]))
    assert top.width == 100
