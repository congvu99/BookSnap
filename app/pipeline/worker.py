"""In-process asyncio worker: OCR -> chunker -> TTS, with resume-on-restart.

## Tail-chunk sealing (why a chunk can be picked up late)

The chunker only ever rewrites the *unsealed tail* chunk of a book — the single
chunk with `sealed=0`, always the highest `seq` (see `replace_tail`). Every time a
new OCR'd page is folded in, the tail's text may grow and get re-split: pieces
before the last one become new *sealed* chunks (a later chunk now exists after
them, so the chunker will never touch them again — decision D-3), and the new
last piece becomes the new unsealed tail.

The TTS worker must never synthesize audio for text that might still change, so
it only claims a chunk when either:
  - `sealed=1` (definitely final), or
  - the book has been idle for `settings.tail_seal_grace_seconds` (no page
    `uploaded`/`ocr_processing`, and `books.updated_at` is old enough) — i.e. we
    have waited long enough to believe no more pages are coming for now.

This means the very last chunk of a finished book gets synthesized a little late
(after the grace period), but never prematurely. `ChunkRepository.claim_next_pending`
encodes this rule directly in its SQL so the check-and-claim is atomic.

## Ordering invariant

The chunker folds in pages strictly in contiguous `seq` order from 0 and stops at
the first seq that is not ready: missing (no upload yet), not yet OCR'd, or
`failed`. A page is resolved once it is `ocr_done` (merged, `chunked=1`) or
`discarded` by a user (`POST /api/books/{id}/pages/{seq}/discard`, also usable
for a missing seq). A failed page is never skipped silently — even after its
image expired — so a book's text order is never scrambled and no page text is
lost without the user deciding so.
"""

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable
from datetime import timedelta
from pathlib import Path

from app.app_context import AppContext
from app.db import now_iso
from app.pipeline import chunker_worker, cleanup_worker, text_chunker
from app.pipeline.ocr_provider import OcrError, OcrProvider, PageText
from app.pipeline.tts_provider import TtsError, TtsProvider
from app.pipeline.tts_router import TtsRouter, content_hash
from app.repositories.chunk_repository import Chunk
from app.repositories.page_repository import Page
from app.repositories.provider_usage_repository import UsageOutcome, UsageService
from app.repositories.row_mapping import new_id

log = logging.getLogger(__name__)

DEFAULT_OCR_BACKOFF_SECONDS: tuple[float, ...] = (2.0, 8.0, 30.0)


class RpmLimiter:
    """Soft, in-memory sliding-window rate limiter for a single provider key."""

    def __init__(self, max_per_minute: int) -> None:
        self.max_per_minute = max(1, max_per_minute)
        self._hits: list[float] = []

    async def throttle(self) -> None:
        while True:
            now = time.monotonic()
            self._hits = [t for t in self._hits if now - t < 60.0]
            if len(self._hits) < self.max_per_minute:
                self._hits.append(now)
                return
            await asyncio.sleep(60.0 - (now - self._hits[0]))


class Worker:
    def __init__(
        self,
        ctx: AppContext,
        *,
        ocr_provider: OcrProvider,
        tts_providers: dict[str, TtsProvider],
        ocr_concurrency: int | None = None,
        tts_concurrency: int | None = None,
        poll_seconds: float | None = None,
        grace_seconds: float | None = None,
        cleanup_interval_seconds: float | None = None,
        ocr_backoff_seconds: tuple[float, ...] = DEFAULT_OCR_BACKOFF_SECONDS,
        tts_backoff_seconds: tuple[float, ...] | None = None,
        ocr_rpm_limiter: RpmLimiter | None = None,
        tts_rpm_limiters: dict[str, RpmLimiter] | None = None,
    ) -> None:
        self.ctx = ctx
        self.ocr = ocr_provider
        self.router = TtsRouter(tts_providers) if tts_backoff_seconds is None else TtsRouter(tts_providers, tts_backoff_seconds)
        s = ctx.settings
        self.ocr_concurrency = ocr_concurrency if ocr_concurrency is not None else s.ocr_concurrency
        self.tts_concurrency = tts_concurrency if tts_concurrency is not None else s.tts_concurrency
        self.poll_seconds = poll_seconds if poll_seconds is not None else s.worker_poll_seconds
        self.grace_seconds = grace_seconds if grace_seconds is not None else s.tail_seal_grace_seconds
        self.cleanup_interval_seconds = cleanup_interval_seconds if cleanup_interval_seconds is not None else s.cleanup_interval_seconds
        self.ocr_backoff_seconds = ocr_backoff_seconds
        self.ocr_rpm = ocr_rpm_limiter or RpmLimiter(s.gemini_ocr_rpm)
        self.tts_rpm = tts_rpm_limiters or {name: RpmLimiter(_default_rpm(s, name)) for name in tts_providers}

        self._wake = asyncio.Event()
        self._tasks: list[asyncio.Task] = []
        self._pause_until: dict[str, str] = {}  # provider -> ISO timestamp, in-memory only

    def wake(self) -> None:
        self._wake.set()

    # --- lifecycle ---------------------------------------------------------------

    async def start(self) -> None:
        await self.resume()
        self._tasks = (
            [asyncio.create_task(self._ocr_loop()) for _ in range(self.ocr_concurrency)]
            + [asyncio.create_task(self._tts_loop()) for _ in range(self.tts_concurrency)]
            + [asyncio.create_task(self._chunk_loop()), asyncio.create_task(self._cleanup_loop())]
        )

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    async def resume(self) -> None:
        """Startup resume (D7): in-flight rows a crashed process left behind go back to their queue."""
        resumed_pages = await self.ctx.pages.resume_processing()
        resumed_chunks = await self.ctx.chunks.resume_processing()
        if resumed_pages or resumed_chunks:
            log.info("worker_resume pages=%d chunks=%d", resumed_pages, resumed_chunks)
        await self.cleanup_once()

    async def _run_forever(self, name: str, step: Callable[[], Awaitable[bool]]) -> None:
        """Run `step` until cancelled; an unexpected error is logged and the loop keeps going."""
        while True:
            try:
                if not await step():
                    await self._sleep_or_wake()
            except asyncio.CancelledError:
                return
            except Exception:
                log.exception("worker_loop outcome=crash loop=%s", name)
                await asyncio.sleep(self.poll_seconds)

    async def _sleep_or_wake(self) -> None:
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=self.poll_seconds)
        except TimeoutError:
            pass
        finally:
            self._wake.clear()

    # --- OCR -----------------------------------------------------------------------

    async def _ocr_loop(self) -> None:
        await self._run_forever("ocr", self.claim_and_process_page)

    async def claim_and_process_page(self) -> bool:
        page = await self.ctx.pages.claim_next_uploaded()
        if page is None:
            return False
        try:
            await self.process_page(page)
        except Exception as exc:
            await self.ctx.pages.mark_failed(page.id, f"Lỗi không mong đợi khi nhận dạng chữ ({type(exc).__name__})")
            raise
        return True

    async def process_page(self, page: Page) -> None:
        started = time.monotonic()
        if not page.image_path:
            await self.ctx.pages.mark_failed(page.id, "Thiếu ảnh gốc, không thể OCR")
            log.info("ocr outcome=error page_id=%s error=missing_image", page.id)
            return
        try:
            image_bytes = await asyncio.to_thread(Path(page.image_path).read_bytes)
        except FileNotFoundError:
            await self.ctx.pages.mark_failed(page.id, "Thiếu ảnh gốc, không thể OCR")
            log.info("ocr outcome=error page_id=%s error=missing_image", page.id)
            return
        mime = page.image_mime or "image/jpeg"
        try:
            page_text = await self._ocr_with_retry(image_bytes, mime, page.book_id)
        except OcrError as exc:
            await self.ctx.pages.mark_failed(page.id, exc.message)
            log.info("ocr outcome=error page_id=%s latency_ms=%d error=%s", page.id, _ms_since(started), exc.message)
            return

        text = page_text.text
        old_image_path = page.image_path
        saved = await self.ctx.pages.mark_ocr_done(page.id, text, page_text.continues_on_next_page)
        if saved:
            await asyncio.to_thread(Path(old_image_path).unlink, True)
            await self.ctx.books.touch(page.book_id)
        log.info("ocr outcome=%s page_id=%s chars=%d latency_ms=%d", "ok" if saved else "gone", page.id, len(text), _ms_since(started))
        self.wake()

    async def _ocr_with_retry(self, image: bytes, mime: str, book_id: str) -> PageText:
        last_error: OcrError | None = None
        for delay in (0.0, *self.ocr_backoff_seconds):
            if delay:
                await asyncio.sleep(delay)
            await self.ocr_rpm.throttle()
            try:
                page_text = await self.ocr.extract(image, mime)
            except OcrError as exc:
                await self._meter("gemini_ocr", "quota" if exc.quota else "error", 0, book_id)
                if not exc.retryable:
                    raise
                last_error = exc
            else:
                await self._meter("gemini_ocr", "ok", len(page_text.text), book_id)
                return page_text
        assert last_error is not None
        raise last_error

    # --- chunker ---------------------------------------------------------------------

    async def _chunk_loop(self) -> None:
        async def tick() -> bool:
            await self.chunk_tick()
            return False

        await self._run_forever("chunk", tick)

    async def chunk_tick(self) -> None:
        if await chunker_worker.chunk_tick(self.ctx):
            self.wake()  # a new chunk may now be sealed/eligible for TTS

    # --- TTS -----------------------------------------------------------------------

    async def _tts_loop(self) -> None:
        await self._run_forever("tts", self.claim_and_process_chunk)

    def _available_providers(self) -> list[str]:
        now = now_iso()
        return [p for p in self.router.providers if self._pause_until.get(p, "") <= now]

    async def claim_and_process_chunk(self) -> bool:
        now = now_iso()
        await self.ctx.chunks.requeue_expired_quota(now)
        for provider, until in list(self._pause_until.items()):
            if until <= now:
                del self._pause_until[provider]
        available = self._available_providers()
        if not available:
            return False
        grace_cutoff = now_iso(-timedelta(seconds=self.grace_seconds))
        chunk = await self.ctx.chunks.claim_next_pending(available, now, grace_cutoff)
        if chunk is None:
            return False
        try:
            await self.process_chunk(chunk)
        except Exception as exc:
            await self.ctx.chunks.mark_failed(chunk, f"Lỗi không mong đợi khi chuyển giọng ({type(exc).__name__})")
            raise
        return True

    async def process_chunk(self, chunk: Chunk) -> None:
        started = time.monotonic()
        if not chunk.provider or not chunk.voice:
            await self.ctx.chunks.mark_failed(chunk, "Sách không còn tồn tại")
            return
        new_hash = content_hash(chunk.text, chunk.provider, chunk.voice)
        target_path = self._audio_path(chunk.book_id, chunk.seq, new_hash)

        if chunk.content_hash == new_hash and target_path.is_file():
            await self.ctx.chunks.mark_done(chunk, new_hash, str(target_path), chunk.duration_ms or 0)
            log.info("tts outcome=cached chunk_id=%s provider=%s", chunk.id, chunk.provider)
            return

        await self.tts_rpm[chunk.provider].throttle()
        spoken = text_chunker.spoken_text(chunk.text)
        service: UsageService = "azure_tts" if chunk.provider == "azure" else "gemini_tts"

        async def meter_attempt(error: TtsError | None) -> None:
            outcome: UsageOutcome = "ok" if error is None else "quota" if error.quota else "error"
            await self._meter(service, outcome, len(spoken), chunk.book_id)

        try:
            result = await self.router.synthesize(chunk.provider, spoken, chunk.voice, on_attempt=meter_attempt)
        except TtsError as exc:
            if exc.quota:
                not_before = now_iso(timedelta(seconds=exc.retry_after)) if exc.retry_after else now_iso(timedelta(hours=1))
                await self.ctx.chunks.mark_waiting_quota(chunk, not_before, exc.message)
                self._pause_until[chunk.provider] = max(self._pause_until.get(chunk.provider, ""), not_before)
                log.info("tts outcome=quota chunk_id=%s provider=%s not_before=%s", chunk.id, chunk.provider, not_before)
            else:
                await self.ctx.chunks.mark_failed(chunk, exc.message)
                log.info("tts outcome=error chunk_id=%s provider=%s error=%s", chunk.id, chunk.provider, exc.message)
            return

        target_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target_path.with_name(f".tmp-{new_id()}.mp3")
        await asyncio.to_thread(tmp_path.write_bytes, result.mp3)
        await asyncio.to_thread(os.replace, tmp_path, target_path)

        old_path = chunk.audio_path
        saved = await self.ctx.chunks.mark_done(chunk, new_hash, str(target_path), result.duration_ms)
        # Stale run (chunk deleted, reset or re-claimed meanwhile): drop our file unless a newer
        # run already points the row at the very same path (identical text+provider+voice).
        if not saved and not await self.ctx.chunks.is_audio_referenced(str(target_path)):
            await asyncio.to_thread(target_path.unlink, True)
        elif saved and old_path and old_path != str(target_path) and not await self.ctx.chunks.is_audio_referenced(old_path):
            await asyncio.to_thread(Path(old_path).unlink, True)
        log.info(
            "tts outcome=%s chunk_id=%s provider=%s chars=%d latency_ms=%d",
            "ok" if saved else "gone",
            chunk.id,
            chunk.provider,
            len(chunk.text),
            _ms_since(started),
        )

    async def _meter(self, service: UsageService, outcome: UsageOutcome, chars: int, book_id: str) -> None:
        """Usage metering is best-effort: a failed insert must never fail the page or chunk."""
        try:
            await self.ctx.usage.record(service, outcome, chars, book_id)
        except Exception:
            log.exception("usage_meter outcome=error service=%s", service)

    def _audio_path(self, book_id: str, seq: int, hash_hex: str) -> Path:
        return self.ctx.settings.library_dir / book_id / f"{seq:05d}-{hash_hex[:8]}.mp3"

    # --- cleanup (D4: temp images have a TTL; orphan temp files are swept up) --------

    async def _cleanup_loop(self) -> None:
        async def step() -> bool:
            await asyncio.sleep(self.cleanup_interval_seconds)
            await self.cleanup_once()
            return True

        await self._run_forever("cleanup", step)

    async def cleanup_once(self) -> None:
        await cleanup_worker.cleanup_once(self.ctx)


def _default_rpm(settings, provider: str) -> int:
    return settings.gemini_tts_rpm if provider == "gemini" else settings.azure_tts_rpm


def _ms_since(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
