"""Gemini TTS: PCM s16le 24kHz mono response -> MP3 via `audio_encoding` (D8).

Uses a single prebuilt voice + a fixed style prompt (`settings.gemini_tts_style`) so
every chunk in a book sounds the same. Uses the async client (`client.aio`).
"""

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.pipeline.audio_encoding import pcm16_to_mp3
from app.pipeline.tts_provider import SynthResult, TtsError

GEMINI_TIMEOUT_MS = 120_000  # SDK default is no timeout; a hung call would pin a worker loop

SAMPLE_RATE = 24000


class GeminiTtsProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, style_prompt: str) -> None:
        self._api_key = api_key
        self._model = model
        self._style_prompt = style_prompt
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS)) if api_key else None

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        if self._client is None:
            raise TtsError("Chưa cấu hình gemini", retryable=False)
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=f"{self._style_prompt}\n{text}",
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))
                    ),
                ),
            )
        except genai_errors.APIError as exc:
            raise _map_error(exc) from exc
        except (TimeoutError, OSError, httpx.HTTPError) as exc:
            raise TtsError(f"Lỗi mạng khi gọi TTS: {exc}", retryable=True) from exc

        pcm = _extract_pcm(response)
        if pcm is None:
            raise TtsError("Phản hồi TTS không có audio", retryable=True)
        mp3, duration_ms = pcm16_to_mp3(pcm, sample_rate=SAMPLE_RATE)
        return SynthResult(mp3=mp3, duration_ms=duration_ms)


def _extract_pcm(response: "types.GenerateContentResponse") -> bytes | None:
    candidates = response.candidates or []
    if not candidates or candidates[0].content is None:
        return None
    for part in candidates[0].content.parts or []:
        if part.inline_data is not None and part.inline_data.data:
            return part.inline_data.data
    return None


def _map_error(exc: genai_errors.APIError) -> TtsError:
    code = exc.code or 0
    message = exc.message or str(exc)
    if code == 429:
        retry_after = _retry_after_seconds(exc)
        return TtsError(f"Hết quota TTS ({code})", retryable=False, quota=True, retry_after=retry_after)
    if code >= 500:
        return TtsError(f"Lỗi TTS tạm thời ({code}): {message}", retryable=True)
    return TtsError(f"Lỗi TTS: {message}", retryable=False)


def _retry_after_seconds(exc: genai_errors.APIError) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None
