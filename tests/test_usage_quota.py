"""Provider usage metering (per call attempt) and the /api/usage quota summary."""

from datetime import UTC, datetime, timedelta

from app.db import now_iso, to_iso
from app.pipeline.ocr_provider import OcrError, PageText
from app.pipeline.tts_provider import SynthResult, TtsError
from app.pipeline.worker import Worker
from app.usage_quota import PACIFIC, window_bounds
from tests.conftest import ctx_of

FAST = (0.01, 0.01, 0.01)


class FlakyOcr:
    """429 on the first call, then succeeds."""

    def __init__(self) -> None:
        self.calls = 0

    async def extract(self, image: bytes, mime: str) -> PageText:
        self.calls += 1
        if self.calls == 1:
            raise OcrError("429", retryable=True, quota=True)
        return PageText(paragraphs=["Một đoạn văn."], continues_on_next_page=False)


class ScriptedTts:
    name = "gemini"

    def __init__(self, errors: list[TtsError]) -> None:
        self.errors = errors

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        if self.errors:
            raise self.errors.pop(0)
        return SynthResult(mp3=b"MP3", duration_ms=100)


def _worker(app, ocr, tts) -> Worker:
    return Worker(
        ctx_of(app),
        ocr_provider=ocr,
        tts_providers=tts,
        poll_seconds=0.01,
        grace_seconds=0.0,
        ocr_backoff_seconds=FAST,
        tts_backoff_seconds=FAST,
    )


async def _usage_rows(app) -> list[tuple[str, str, int]]:
    rows = await ctx_of(app).db.fetchall("SELECT service, outcome, chars FROM provider_usage ORDER BY id")
    return [(r["service"], r["outcome"], r["chars"]) for r in rows]


async def _book_with_chunk(app, text: str = "Xin chào cả nhà."):
    ctx = ctx_of(app)
    user = await ctx.users.get_by_username("alice")
    book = await ctx.books.create("Sách", user.id, "gemini", "Kore")
    await ctx.db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, status, provider, voice, sealed, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ("c0", book.id, 0, text, "pending", "gemini", "Kore", 1, now_iso()),
    )
    return book


def test_pacific_day_window_follows_dst():
    # 2026-03-08 is the US spring-forward day: 23 hours long.
    start, end = window_bounds("pacific_day", datetime(2026, 3, 8, 20, 0, tzinfo=UTC))
    assert start.astimezone(PACIFIC).hour == 0 and start.date().isoformat() == "2026-03-08"
    # Same-tzinfo subtraction is wall-clock; the real elapsed time needs UTC.
    assert end.astimezone(UTC) - start.astimezone(UTC) == timedelta(hours=23)
    # 07:30 UTC is still the previous day in Los Angeles.
    start, _ = window_bounds("pacific_day", datetime(2026, 9, 29, 6, 30, tzinfo=UTC))
    assert start.date().isoformat() == "2026-09-28"


def test_utc_month_window_rolls_over_year():
    start, end = window_bounds("utc_month", datetime(2026, 12, 31, 23, 59, tzinfo=UTC))
    assert (start, end) == (datetime(2026, 12, 1, tzinfo=UTC), datetime(2027, 1, 1, tzinfo=UTC))


async def test_ocr_attempts_are_metered_including_quota_retry(app, alice):
    ctx = ctx_of(app)
    user = await ctx.users.get_by_username("alice")
    book = await ctx.books.create("Sách", user.id, "gemini", "Kore")
    ctx.settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    image = ctx.settings.tmp_dir / "p0.jpg"
    image.write_bytes(b"img")
    await ctx.pages.create(book.id, 0, str(image), "image/jpeg", None)

    assert await _worker(app, FlakyOcr(), {}).claim_and_process_page()
    assert await _usage_rows(app) == [("gemini_ocr", "quota", 0), ("gemini_ocr", "ok", len("Một đoạn văn."))]


async def test_tts_retries_and_quota_are_metered_per_attempt(app, alice):
    await _book_with_chunk(app)
    tts = ScriptedTts([TtsError("503", retryable=True), TtsError("429", retryable=False, quota=True, retry_after=600)])
    worker = _worker(app, FlakyOcr(), {"gemini": tts})
    assert await worker.claim_and_process_chunk()
    assert await _usage_rows(app) == [("gemini_tts", "error", 0), ("gemini_tts", "quota", 0)]


async def test_usage_summary_reports_remaining_and_pause(app, alice):
    ctx = ctx_of(app)
    ctx.settings.gemini_api_key = "k"
    ctx.settings.gemini_tts_rpd = 5
    ctx.settings.gemini_ocr_rpd = 2
    await _book_with_chunk(app)
    for outcome in ("ok", "ok", "error", "quota"):
        await ctx.usage.record("gemini_tts", outcome, 40, None)
    await ctx.usage.record("gemini_ocr", "ok", 10, None)
    await ctx.usage.record("gemini_ocr", "ok", 10, None)
    # Yesterday's (Pacific) usage has already been reset.
    await ctx.db.execute(
        "INSERT INTO provider_usage(service, outcome, chars, created_at) VALUES ('gemini_tts','ok',0,?)",
        (to_iso(datetime.now(UTC) - timedelta(days=2)),),
    )
    until = now_iso(timedelta(minutes=30))
    await ctx.db.execute("UPDATE chunks SET status='waiting_quota', not_before=? WHERE id='c0'", (until,))

    body = (await alice.get("/api/usage")).json()
    by_service = {s["service"]: s for s in body["services"]}
    tts = by_service["gemini_tts"]
    assert (tts["used"], tts["limit"], tts["remaining"], tts["quota_hits"]) == (3, 5, 2, 1)
    assert tts["status"] == "paused" and tts["paused_until"] == until and tts["waiting_chunks"] == 1
    assert by_service["gemini_ocr"]["status"] == "exhausted" and by_service["gemini_ocr"]["remaining"] == 0
    azure = by_service["azure_tts"]
    assert azure["status"] == "unconfigured" and azure["limit"] is None and azure["remaining"] is None


async def test_usage_requires_login(anon):
    assert (await anon.get("/api/usage")).status_code == 401


async def test_cleanup_prunes_old_usage(app, alice):
    ctx = ctx_of(app)
    await ctx.usage.record("gemini_ocr", "ok", 1, None)
    await ctx.db.execute(
        "INSERT INTO provider_usage(service, outcome, chars, created_at) VALUES ('gemini_ocr','ok',1,?)",
        (now_iso(-timedelta(days=ctx.settings.usage_retention_days + 1)),),
    )
    await _worker(app, FlakyOcr(), {}).cleanup_once()
    assert len(await _usage_rows(app)) == 1
