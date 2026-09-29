"""Voice previews: one fixed Vietnamese sentence per voice, synthesized once and cached on disk.

Previews spend the household's shared TTS quota, so every path is bounded:
- the sample text is a server constant (clients can never send text to TTS);
- one in-flight synthesis per voice, shared by every waiting request (success or failure) and
  detached from the request, so a closed tab does not waste a call that was already paid for;
- failures are remembered (60s, or until the provider's Retry-After on quota errors);
- each user may trigger at most `PER_USER_CALLS_PER_MINUTE` provider calls.

The cache key covers provider, voice, model, style and text, read from the provider instance
that actually synthesizes, so a style/model change yields a new file and a new preview URL.
State is in-process only, matching the single-replica deployment.
"""

import asyncio
import hashlib
import logging
import math
import os
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from urllib.parse import quote

from app.auth.rate_limiter import RateLimiter
from app.config import Settings
from app.pipeline.tts_azure import AzureTtsProvider
from app.pipeline.tts_gemini import GeminiTtsProvider
from app.pipeline.tts_provider import TtsError, TtsProvider
from app.repositories.provider_usage_repository import ProviderUsageRepository
from app.tts_voices import provider_configured

log = logging.getLogger(__name__)

PREVIEW_TEXT = "Xin chào, tôi sẽ đọc cuốn sách này cho bạn nghe. Mời bạn thư giãn và lắng nghe từng trang sách."
FAILURE_TTL_SECONDS = 60.0
QUOTA_DEFAULT_RETRY_SECONDS = 60.0
WAIT_TIMEOUT_SECONDS = 30.0
PER_USER_CALLS_PER_MINUTE = 6


class PreviewError(Exception):
    """User-facing failure; `code` maps to an API error, never carries provider text."""

    def __init__(self, code: str, retry_after: float | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after

    @property
    def retry_after_header(self) -> str | None:
        return str(math.ceil(self.retry_after)) if self.retry_after is not None else None


def default_provider_factory(settings: Settings) -> Callable[[str], TtsProvider]:
    def build(name: str) -> TtsProvider:
        if name == "gemini":
            return GeminiTtsProvider(settings.gemini_api_key, settings.gemini_tts_model, settings.gemini_tts_style)
        return AzureTtsProvider(settings.azure_speech_key, settings.azure_speech_region)

    return build


class VoicePreviewService:
    def __init__(self, settings: Settings, usage: ProviderUsageRepository) -> None:
        self.settings = settings
        self.usage = usage
        self.cache_dir = settings.data_dir / "voice-previews"
        self.provider_factory: Callable[[str], TtsProvider] = default_provider_factory(settings)
        self._providers: dict[str, TtsProvider] = {}
        self._inflight: dict[str, asyncio.Task[Path]] = {}
        self._failures: dict[str, tuple[float, PreviewError]] = {}
        self._user_limiter = RateLimiter(PER_USER_CALLS_PER_MINUTE, 60.0)

    def reset_providers(self) -> None:
        self._providers.clear()

    def provider(self, name: str) -> TtsProvider:
        if name not in self._providers:
            self._providers[name] = self.provider_factory(name)
        return self._providers[name]

    def is_configured(self, name: str) -> bool:
        # Real providers have no `configured` attribute, so production always uses the settings
        # check; the attribute exists only so injected test providers can declare themselves usable.
        declared = getattr(self.provider(name), "configured", None)
        return declared if isinstance(declared, bool) else provider_configured(self.settings, name)  # type: ignore[arg-type]

    def cache_key(self, provider_name: str, voice: str) -> str:
        provider = self.provider(provider_name)
        parts = [provider_name, voice, getattr(provider, "model", ""), getattr(provider, "style", ""), PREVIEW_TEXT]
        return hashlib.sha256("\x00".join(parts).encode()).hexdigest()[:16]

    def preview_url(self, provider_name: str, voice: str) -> str:
        return f"/api/voices/{provider_name}/{quote(voice, safe='')}/preview?v={self.cache_key(provider_name, voice)}"

    async def get(self, provider_name: str, voice: str, user_id: str) -> tuple[Path, bool]:
        """Return (mp3 path, cache_hit). Raises PreviewError."""
        key = self.cache_key(provider_name, voice)
        path = self.cache_dir / f"{key}.mp3"
        if path.is_file():
            return path, True

        failure = self._failures.get(key)
        if failure is not None:
            until, error = failure
            remaining = until - time.monotonic()
            if remaining > 0:
                raise PreviewError(error.code, remaining if error.code == "tts_quota" else None)
            del self._failures[key]

        task = self._inflight.get(key)
        if task is None:
            retry = self._user_limiter.hit(user_id)
            if retry is not None:
                raise PreviewError("rate_limited", retry)
            task = asyncio.create_task(self._synthesize(key, path, provider_name, voice, user_id))
            self._inflight[key] = task
            task.add_done_callback(lambda t, k=key: self._on_done(k, t))
        try:
            return await asyncio.wait_for(asyncio.shield(task), WAIT_TIMEOUT_SECONDS), False
        except TimeoutError as exc:
            raise PreviewError("tts_timeout") from exc

    def _on_done(self, key: str, task: asyncio.Task[Path]) -> None:
        self._inflight.pop(key, None)
        if not task.cancelled():
            task.exception()  # retrieved here so a timed-out-and-abandoned task never logs "never retrieved"

    async def _synthesize(self, key: str, path: Path, provider_name: str, voice: str, user_id: str) -> Path:
        service = "gemini_tts" if provider_name == "gemini" else "azure_tts"
        started = time.monotonic()
        try:
            result = await self.provider(provider_name).synthesize(PREVIEW_TEXT, voice)
        except TtsError as exc:
            await self._record_usage(service, "quota" if exc.quota else "error", 0)
            error = (
                PreviewError("tts_quota", exc.retry_after or QUOTA_DEFAULT_RETRY_SECONDS)
                if exc.quota
                else PreviewError("tts_failed")
            )
            self._remember_failure(key, error)
            log.warning("voice_preview_failed user_id=%s provider=%s voice=%s error=%s", user_id, provider_name, voice, exc.message)
            raise error from exc
        except Exception as exc:
            await self._record_usage(service, "error", 0)
            error = PreviewError("tts_failed")
            self._remember_failure(key, error)
            log.exception("voice_preview_crashed user_id=%s provider=%s voice=%s", user_id, provider_name, voice)
            raise error from exc

        # File first: the call is already paid for, so a usage-log hiccup must not lose the audio.
        try:
            await asyncio.to_thread(self._write_atomic, key, path, result.mp3)
        except OSError as exc:
            await self._record_usage(service, "ok", len(PREVIEW_TEXT))
            error = PreviewError("tts_failed")
            self._remember_failure(key, error)
            log.exception("voice_preview_write_failed user_id=%s provider=%s voice=%s", user_id, provider_name, voice)
            raise error from exc
        await self._record_usage(service, "ok", len(PREVIEW_TEXT))
        log.info(
            "voice_preview_synth user_id=%s provider=%s voice=%s ms=%d",
            user_id, provider_name, voice, (time.monotonic() - started) * 1000,
        )
        return path

    def _write_atomic(self, key: str, path: Path, data: bytes) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_dir / f"{key}.{uuid.uuid4().hex}.tmp"
        try:
            tmp.write_bytes(data)
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)

    async def _record_usage(self, service: str, outcome: str, chars: int) -> None:
        """Accounting is best-effort: it must never turn a served preview into an error."""
        try:
            await self.usage.record(service, outcome, chars, None)
        except Exception:
            log.exception("voice_preview_usage_record_failed service=%s outcome=%s", service, outcome)

    def _remember_failure(self, key: str, error: PreviewError) -> None:
        ttl = error.retry_after if error.code == "tts_quota" and error.retry_after else FAILURE_TTL_SECONDS
        self._failures[key] = (time.monotonic() + ttl, error)
