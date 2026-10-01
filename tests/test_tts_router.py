"""TtsRouter + Worker TTS claiming: quota pausing, backoff-then-fail, and content-hash caching.

Uses the app fixture only to get a fully wired AppContext (repositories + a real
sqlite db) — the app's own worker is disabled in tests (`worker_enabled=False`),
so these tests build their own `Worker` with fake providers and instant backoff.
"""

import asyncio

import pytest

from app.db import now_iso
from app.pipeline.ocr_provider import OcrProvider, PageText
from app.pipeline.tts_provider import SynthResult, TtsError, TtsProvider
from app.pipeline.tts_router import content_hash
from app.pipeline.worker import Worker
from app.repositories.row_mapping import new_id
from tests.conftest import ctx_of, profile_id_of

FAST_BACKOFF = (0.01, 0.01, 0.01)


class DummyOcr(OcrProvider):
    async def extract(self, image: bytes, mime: str) -> PageText:
        raise NotImplementedError("not exercised in these tests")


class ScriptedTts(TtsProvider):
    """Replays a fixed sequence of return values / exceptions, one per call."""

    def __init__(self, name: str, outcomes: list) -> None:
        self.name = name
        self._outcomes = list(outcomes)
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        self.calls.append((text, voice))
        if not self._outcomes:
            raise AssertionError(f"{self.name} synthesize called more times than scripted")
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


async def _make_book(app, provider="gemini", voice="Kore") -> dict:
    ctx = ctx_of(app)
    user_id = await profile_id_of(app, "Alice Nguyễn")
    book = await ctx.books.create("Sách test", user_id, provider, voice)
    return book


async def _insert_pending_chunk(app, book_id: str, seq: int, text: str, *, sealed: int = 1, content_hash_: str | None = None) -> str:
    ctx = ctx_of(app)
    chunk_id = new_id()
    await ctx.db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, content_hash, status, sealed, updated_at) VALUES (?,?,?,?,?,'pending',?,?)",
        (chunk_id, book_id, seq, text, content_hash_, sealed, now_iso()),
    )
    return chunk_id


def _worker(app, tts_providers: dict[str, TtsProvider]) -> Worker:
    return Worker(
        ctx_of(app),
        ocr_provider=DummyOcr(),
        tts_providers=tts_providers,
        tts_concurrency=1,
        poll_seconds=0.01,
        grace_seconds=0.0,
        tts_backoff_seconds=FAST_BACKOFF,
    )


async def test_quota_pauses_provider_and_does_not_touch_azure(alice, app):
    book = await _make_book(app, provider="gemini")
    chunk_a = await _insert_pending_chunk(app, book.id, 0, "Đoạn A")
    chunk_b = await _insert_pending_chunk(app, book.id, 1, "Đoạn B")

    # not_before has second-level granularity (app.db.now_iso truncates microseconds),
    # so retry_after must be >= 1s to land in a strictly-later second than "now".
    gemini = ScriptedTts("gemini", [TtsError("Hết quota", retryable=False, quota=True, retry_after=1)])
    azure = ScriptedTts("azure", [])
    worker = _worker(app, {"gemini": gemini, "azure": azure})

    assert await worker.claim_and_process_chunk() is True
    ctx = ctx_of(app)
    a = await ctx.chunks.get(chunk_a)
    assert a.status == "waiting_quota" and a.not_before is not None

    # provider paused: chunk B (same provider) is not claimed even though it's pending
    assert await worker.claim_and_process_chunk() is False
    b = await ctx.chunks.get(chunk_b)
    assert b.status == "pending"
    assert azure.calls == []

    await asyncio.sleep(1.2)  # let not_before / pause (second-granularity) expire

    gemini._outcomes.append(SynthResult(mp3=b"ID3fake", duration_ms=500))
    assert await worker.claim_and_process_chunk() is True
    a_again = await ctx.chunks.get(chunk_a)
    assert a_again.status == "done"
    assert azure.calls == []


async def test_five_xx_retries_then_fails_with_error(alice, app):
    book = await _make_book(app, provider="gemini")
    chunk_id = await _insert_pending_chunk(app, book.id, 0, "Đoạn lỗi")
    gemini = ScriptedTts(
        "gemini",
        [
            TtsError("Lỗi server 500", retryable=True),
            TtsError("Lỗi server 500", retryable=True),
            TtsError("Lỗi server 500", retryable=True),
            TtsError("Lỗi server 500", retryable=True),
        ],
    )
    worker = _worker(app, {"gemini": gemini})

    assert await worker.claim_and_process_chunk() is True
    chunk = await ctx_of(app).chunks.get(chunk_id)
    assert chunk.status == "failed"
    assert chunk.error and "500" in chunk.error
    assert len(gemini.calls) == 4  # 1 initial attempt + 3 retries


async def test_cache_hit_skips_provider_call(alice, app):
    book = await _make_book(app, provider="gemini")
    text = "Đoạn đã có sẵn audio."
    voice = book.tts_voice
    existing_hash = content_hash(text, "gemini", voice)
    audio_dir = ctx_of(app).settings.library_dir / book.id
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / f"00000-{existing_hash[:8]}.mp3"
    audio_path.write_bytes(b"already-there")
    chunk_id = await _insert_pending_chunk(app, book.id, 0, text, content_hash_=existing_hash)
    # duration_ms must already be set for the cache path to reuse it
    await ctx_of(app).db.execute("UPDATE chunks SET duration_ms=? WHERE id=?", (1234, chunk_id))

    gemini = ScriptedTts("gemini", [])  # must never be called
    worker = _worker(app, {"gemini": gemini})

    assert await worker.claim_and_process_chunk() is True
    chunk = await ctx_of(app).chunks.get(chunk_id)
    assert chunk.status == "done"
    assert chunk.audio_path == str(audio_path)
    assert chunk.duration_ms == 1234
    assert gemini.calls == []


async def test_missing_api_key_fails_fast_without_retry(alice, app):
    book = await _make_book(app, provider="azure")
    chunk_id = await _insert_pending_chunk(app, book.id, 0, "Đoạn không có key")
    azure = ScriptedTts("azure", [TtsError("Chưa cấu hình azure", retryable=False)])
    worker = _worker(app, {"azure": azure})

    assert await worker.claim_and_process_chunk() is True
    chunk = await ctx_of(app).chunks.get(chunk_id)
    assert chunk.status == "failed"
    assert len(azure.calls) == 1  # no retry for non-retryable errors
