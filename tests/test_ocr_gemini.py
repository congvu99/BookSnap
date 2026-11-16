"""GeminiOcrProvider: an unparseable reply says why Gemini stopped; a recitation block is flagged for the fallback."""

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


async def _extract_error(response: types.GenerateContentResponse) -> OcrError:
    with pytest.raises(OcrError) as caught:
        await _provider_returning(response).extract(b"img", "image/jpeg")
    return caught.value


async def test_unparseable_reply_reports_finish_reason_and_token_usage() -> None:
    error = await _extract_error(
        types.GenerateContentResponse(
            candidates=[types.Candidate(finish_reason=types.FinishReason.MAX_TOKENS)],
            usage_metadata=types.GenerateContentResponseUsageMetadata(candidates_token_count=0, thoughts_token_count=812),
        )
    )

    assert error.message == (
        "Phản hồi OCR không đúng định dạng (finish_reason=MAX_TOKENS, output_tokens=0, thinking_tokens=812)"
    )
    assert error.retryable is True
    assert error.recitation is False


async def test_recitation_is_flagged_and_not_retried() -> None:
    error = await _extract_error(
        types.GenerateContentResponse(candidates=[types.Candidate(finish_reason=types.FinishReason.RECITATION)])
    )

    assert error.message == "Phản hồi OCR không đúng định dạng (finish_reason=RECITATION)"
    assert error.recitation is True
    assert error.retryable is False


async def test_blocked_prompt_reports_block_reason() -> None:
    error = await _extract_error(
        types.GenerateContentResponse(
            prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=types.BlockedReason.SAFETY),
        )
    )

    assert error.message == "Phản hồi OCR không đúng định dạng (block_reason=SAFETY)"


async def test_reply_without_any_metadata_keeps_the_plain_message() -> None:
    error = await _extract_error(types.GenerateContentResponse())

    assert error.message == "Phản hồi OCR không đúng định dạng"
