"""Azure Speech TTS via REST (D7 — no Speech SDK, it is too heavy to build on Railpack).

Duration is estimated from the MP3 byte length at the fixed 48kbps output bitrate
(`audio-24khz-48kbitrate-mono-mp3`), since the REST endpoint does not return one.
"""

import xml.sax.saxutils as xml_escape

import httpx

from app.pipeline.tts_provider import SynthResult, TtsError

OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
OUTPUT_BITRATE_KBPS = 48
TIMEOUT_SECONDS = 60.0


def _build_ssml(text: str, voice: str) -> str:
    escaped = xml_escape.escape(text)
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="vi-VN">'
        f'<voice xml:lang="vi-VN" name={xml_escape.quoteattr(voice)}>{escaped}</voice>'
        "</speak>"
    )


class AzureTtsProvider:
    name = "azure"

    def __init__(self, api_key: str, region: str) -> None:
        self._api_key = api_key
        self._region = region

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        if not self._api_key:
            raise TtsError("Chưa cấu hình azure", retryable=False)
        url = f"https://{self._region}.tts.speech.microsoft.com/cognitiveservices/v1"
        headers = {
            "Ocp-Apim-Subscription-Key": self._api_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
            "User-Agent": "booksnap",
        }
        body = _build_ssml(text, voice).encode("utf-8")
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                response = await client.post(url, headers=headers, content=body)
        except httpx.TimeoutException as exc:
            raise TtsError(f"Azure TTS timeout: {exc}", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise TtsError(f"Lỗi mạng khi gọi Azure TTS: {exc}", retryable=True) from exc

        if response.status_code == 429:
            retry_after = _retry_after_seconds(response)
            raise TtsError("Hết quota Azure TTS", retryable=False, quota=True, retry_after=retry_after)
        if response.status_code >= 500:
            raise TtsError(f"Lỗi Azure TTS tạm thời ({response.status_code})", retryable=True)
        if response.status_code >= 400:
            raise TtsError(f"Lỗi Azure TTS ({response.status_code}): {response.text[:200]}", retryable=False)

        mp3 = response.content
        duration_ms = round(len(mp3) * 8 / OUTPUT_BITRATE_KBPS)
        return SynthResult(mp3=mp3, duration_ms=duration_ms)


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None
