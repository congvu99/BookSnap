"""GeminiOcrProvider: an unparseable reply must say why Gemini stopped, so pages.error is diagnosable."""

from types import SimpleNamespace

import pytest
from google.genai import types

from app.pipeline.ocr_gemini import GeminiOcrProvider
from app.pipeline.ocr_provider import OcrError


def _provider_returning(response: types.GenerateContentResponse) -> GeminiOcrProvider:
    async def generate_content(**_kwargs: object) -> types.GenerateContentResponse:
        return response

    provider = GeminiOcrProvider(api_key="", model="test-model")
    provider._client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return provider


async def test_unparseable_reply_reports_finish_reason_and_token_usage() -> None:
    response = types.GenerateContentResponse(
        candidates=[types.Candidate(finish_reason=types.FinishReason.RECITATION)],
        usage_metadata=types.GenerateContentResponseUsageMetadata(candidates_token_count=0, thoughts_token_count=812),
    )

    with pytest.raises(OcrError) as caught:
        await _provider_returning(response).extract(b"img", "image/jpeg")

    assert caught.value.message == (
        "Phản hồi OCR không đúng định dạng (finish_reason=RECITATION, output_tokens=0, thinking_tokens=812)"
    )
    assert caught.value.retryable is True


async def test_blocked_prompt_reports_block_reason() -> None:
    response = types.GenerateContentResponse(
        prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=types.BlockedReason.SAFETY),
    )

    with pytest.raises(OcrError) as caught:
        await _provider_returning(response).extract(b"img", "image/jpeg")

    assert caught.value.message == "Phản hồi OCR không đúng định dạng (block_reason=SAFETY)"


async def test_reply_without_any_metadata_keeps_the_plain_message() -> None:
    with pytest.raises(OcrError) as caught:
        await _provider_returning(types.GenerateContentResponse()).extract(b"img", "image/jpeg")

    assert caught.value.message == "Phản hồi OCR không đúng định dạng"
