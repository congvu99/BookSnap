"""TTS provider contract shared by every backend (Gemini, Azure)."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class SynthResult:
    mp3: bytes
    duration_ms: int


class TtsError(Exception):
    """Raised by TtsProvider.synthesize.

    `quota` (429 / rate limit): the router must not retry internally — the worker
    moves the chunk to `waiting_quota` and pauses the whole provider until
    `retry_after` (seconds from now) elapses, or 1h if the server did not say.
    `retryable` (5xx / network / timeout): the router retries with backoff before
    giving up. Anything else (bad request, missing key, ...) is not retryable.
    """

    def __init__(self, message: str, *, retryable: bool, quota: bool = False, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.quota = quota
        self.retry_after = retry_after


class TtsProvider(Protocol):
    name: str

    async def synthesize(self, text: str, voice: str) -> SynthResult: ...
