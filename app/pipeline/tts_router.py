"""Picks the right TtsProvider for a chunk's book and retries transient failures.

Quota errors are NOT retried here — they must surface immediately so the worker
can move the chunk to `waiting_quota` and pause the whole provider (D11: no
cross-provider fallback, keep the voice consistent within a book). 5xx/timeout
errors are retried with exponential backoff (2s, 8s, 30s by default — injectable
so tests run fast) before giving up.
"""

import asyncio
import hashlib
from collections.abc import Sequence

from app.pipeline.tts_provider import SynthResult, TtsError, TtsProvider

DEFAULT_BACKOFF_SECONDS: tuple[float, ...] = (2.0, 8.0, 30.0)


def content_hash(text: str, provider: str, voice: str) -> str:
    """D6: sha256(text + provider + voice), used to skip re-synthesizing unchanged chunks."""
    payload = f"{text}\x00{provider}\x00{voice}".encode()
    return hashlib.sha256(payload).hexdigest()


class TtsRouter:
    def __init__(self, providers: dict[str, TtsProvider], backoff_seconds: Sequence[float] = DEFAULT_BACKOFF_SECONDS) -> None:
        self.providers = providers
        self.backoff_seconds = tuple(backoff_seconds)

    async def synthesize(self, provider_name: str, text: str, voice: str) -> SynthResult:
        provider = self.providers.get(provider_name)
        if provider is None:
            raise TtsError(f"Chưa cấu hình {provider_name}", retryable=False)
        last_error: TtsError | None = None
        for delay in (0.0, *self.backoff_seconds):
            if delay:
                await asyncio.sleep(delay)
            try:
                return await provider.synthesize(text, voice)
            except TtsError as exc:
                if exc.quota or not exc.retryable:
                    raise
                last_error = exc
        assert last_error is not None
        raise last_error
