"""Worker integration tests: ordering invariant, image cleanup, crash resume, end-to-end.

No network: all OCR/TTS calls go through small fakes. Timings are made tiny via the
Worker's injectable backoff/poll/grace parameters so the suite stays fast.
"""

import asyncio

from app.db import now_iso
from app.pipeline.ocr_provider import OcrProvider, PageText
from app.pipeline.tts_provider import SynthResult, TtsProvider
from app.pipeline.worker import Worker
from app.repositories.row_mapping import new_id
from tests.conftest import ctx_of

FAST = (0.01, 0.01, 0.01)


class FakeOcr(OcrProvider):
    def __init__(self, by_bytes: dict[bytes, PageText]) -> None:
        self.by_bytes = by_bytes
        self.calls = 0

    async def extract(self, image: bytes, mime: str) -> PageText:
        self.calls += 1
        return self.by_bytes[image]


class FakeTts(TtsProvider):
    name = "gemini"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        self.calls.append((text, voice))
        return SynthResult(mp3=f"MP3[{text}]".encode(), duration_ms=len(text) * 10)


def _worker(app, ocr: OcrProvider, tts: dict[str, TtsProvider]) -> Worker:
    return Worker(
        ctx_of(app),
        ocr_provider=ocr,
        tts_providers=tts,
        ocr_concurrency=1,
        tts_concurrency=1,
        poll_seconds=0.01,
        grace_seconds=0.0,
        ocr_backoff_seconds=FAST,
        tts_backoff_seconds=FAST,
    )


async def _make_book(app, provider="gemini"):
    ctx = ctx_of(app)
    user = await ctx.users.get_by_username("alice")
    return await ctx.books.create("Sách worker", user.id, provider, ctx.settings.gemini_tts_voice)


async def _write_tmp_image(app, name: str, content: bytes):
    ctx = ctx_of(app)
    ctx.settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    path = ctx.settings.tmp_dir / name
    path.write_bytes(content)
    return path


async def _run_chunk_and_tts_until_done(worker: Worker, ctx, book_id: str, max_rounds: int = 20) -> None:
    for _ in range(max_rounds):
        await worker.chunk_tick()
        made_progress = await worker.claim_and_process_chunk()
        chunks = await ctx.chunks.list_for_book(book_id)
        if chunks and all(c.status == "done" for c in chunks) and all(p.chunked for p in await ctx.pages.list_for_book(book_id)):
            return
        if not made_progress:
            await asyncio.sleep(0.01)
    raise AssertionError("worker did not converge to all-done in time")


async def test_chunk_tick_respects_ordering_invariant(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    p0 = await ctx.pages.create(book.id, 0, "/fake/p0.jpg", "image/jpeg", None)
    p1 = await ctx.pages.create(book.id, 1, "/fake/p1.jpg", "image/jpeg", None)

    worker = _worker(app, FakeOcr({}), {})

    # page1 finishes OCR before page0 (out-of-order completion)
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p1.id,))
    assert await ctx.pages.mark_ocr_done(p1.id, "Nội dung trang hai.", False)

    await worker.chunk_tick()
    assert await ctx.chunks.list_for_book(book.id) == []  # blocked: page0 still 'uploaded'

    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p0.id,))
    assert await ctx.pages.mark_ocr_done(p0.id, "Nội dung trang một.", False)
    await worker.chunk_tick()

    chunks = await ctx.chunks.list_for_book(book.id)
    assert len(chunks) == 1
    # Page one does not continue onto page two, so they stay separate paragraphs, in seq order.
    assert chunks[0].text == "Nội dung trang một.\nNội dung trang hai."
    pages = await ctx.pages.list_for_book(book.id)
    assert all(p.chunked for p in pages)


async def test_expired_failed_page_blocks_until_discarded(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    p0 = await ctx.pages.create(book.id, 0, "/fake/p0.jpg", "image/jpeg", None)
    p1 = await ctx.pages.create(book.id, 1, "/fake/p1.jpg", "image/jpeg", None)
    # p0 failed and its image already expired: it can no longer be retried, but is never skipped silently
    await ctx.db.execute("UPDATE pages SET status='failed', image_path=NULL WHERE id=?", (p0.id,))
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p1.id,))
    assert await ctx.pages.mark_ocr_done(p1.id, "Chỉ còn trang hai.", False)

    worker = _worker(app, FakeOcr({}), {})
    await worker.chunk_tick()
    assert await ctx.chunks.list_for_book(book.id) == []

    assert (await alice.post(f"/api/books/{book.id}/pages/0/discard")).status_code == 200
    await worker.chunk_tick()
    chunks = await ctx.chunks.list_for_book(book.id)
    assert len(chunks) == 1 and chunks[0].text == "Chỉ còn trang hai."
    assert (await ctx.pages.get(p0.id)).chunked == 1


async def test_failed_page_with_image_still_blocks_later_pages(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    p0 = await ctx.pages.create(book.id, 0, "/fake/p0.jpg", "image/jpeg", None)
    p1 = await ctx.pages.create(book.id, 1, "/fake/p1.jpg", "image/jpeg", None)
    await ctx.db.execute("UPDATE pages SET status='failed' WHERE id=?", (p0.id,))  # image_path still set
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p1.id,))
    assert await ctx.pages.mark_ocr_done(p1.id, "Trang hai.", False)

    worker = _worker(app, FakeOcr({}), {})
    await worker.chunk_tick()
    assert await ctx.chunks.list_for_book(book.id) == []


async def test_ocr_success_deletes_temp_image(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    img_path = await _write_tmp_image(app, "p0.jpg", b"raw-image-bytes")
    page = await ctx.pages.create(book.id, 0, str(img_path), "image/jpeg", None)
    ocr = FakeOcr({b"raw-image-bytes": PageText(paragraphs=["Văn bản đã OCR."], continues_on_next_page=False)})
    worker = _worker(app, ocr, {})

    assert await worker.claim_and_process_page() is True
    assert not img_path.exists()
    refreshed = await ctx.pages.get(page.id)
    assert refreshed.status == "ocr_done" and refreshed.text == "Văn bản đã OCR." and refreshed.image_path is None


async def test_crash_resume_completes_without_duplicate_files(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    img_path = await _write_tmp_image(app, "p0.jpg", b"crash-page")
    page = await ctx.pages.create(book.id, 0, str(img_path), "image/jpeg", None)
    chunk_id = new_id()
    await ctx.db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, status, sealed, updated_at) VALUES (?,?,?,?,?,?,?)",
        (chunk_id, book.id, 0, "Một đoạn khác đã tách sẵn.", "pending", 1, now_iso()),
    )
    # simulate a crash: an OCR worker and a TTS worker both mid-flight
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (page.id,))
    await ctx.db.execute("UPDATE chunks SET status='processing' WHERE id=?", (chunk_id,))

    ocr = FakeOcr({b"crash-page": PageText(paragraphs=["Trang sau khi phục hồi."], continues_on_next_page=False)})
    tts = FakeTts()
    worker = _worker(app, ocr, {"gemini": tts})

    await worker.resume()
    assert (await ctx.pages.get(page.id)).status == "uploaded"
    assert (await ctx.chunks.get(chunk_id)).status == "pending"

    assert await worker.claim_and_process_page() is True
    await worker.chunk_tick()
    assert await worker.claim_and_process_chunk() is True  # the pre-existing sealed chunk
    await _run_chunk_and_tts_until_done(worker, ctx, book.id)

    chunks = await ctx.chunks.list_for_book(book.id)
    assert all(c.status == "done" for c in chunks)
    library_files = list((ctx.settings.library_dir / book.id).glob("*.mp3"))
    assert len(library_files) == len(chunks)  # no duplicate/leftover files


async def test_end_to_end_upload_via_api_to_playable_audio(alice, app):
    ctx = ctx_of(app)
    r = await alice.post("/api/books", json={"title": "API sách", "tts_provider": "gemini"})
    assert r.status_code == 201
    book_id = r.json()["id"]

    img_bytes = b"\xff\xd8\xff\xe0" + b"\x11" * 32 + b"\xff\xd9"
    upload = await alice.post(
        f"/api/books/{book_id}/pages",
        files={"image": ("p.jpg", img_bytes, "image/jpeg")},
        data={"seq": "0"},
    )
    assert upload.status_code == 202

    ocr = FakeOcr({img_bytes: PageText(paragraphs=["Nội dung trang một từ API."], continues_on_next_page=False)})
    tts = FakeTts()
    worker = _worker(app, ocr, {"gemini": tts})

    assert await worker.claim_and_process_page() is True
    await _run_chunk_and_tts_until_done(worker, ctx, book_id)

    listed = await alice.get(f"/api/books/{book_id}/chunks")
    chunks = listed.json()
    assert len(chunks) == 1 and chunks[0]["status"] == "done"
    assert chunks[0]["audio_url"]

    audio = await alice.get(chunks[0]["audio_url"])
    assert audio.status_code == 200
    assert audio.content == "MP3[Nội dung trang một từ API.]".encode()


async def test_full_start_stop_lifecycle_processes_in_background(alice, app):
    """Exercises the real background loops (not direct method calls), including wake()
    and a clean cancel-on-stop, unlike the other tests in this module."""
    ctx = ctx_of(app)
    r = await alice.post("/api/books", json={"title": "Lifecycle sách", "tts_provider": "gemini"})
    book_id = r.json()["id"]
    img_bytes = b"\xff\xd8\xff\xe0" + b"\x22" * 32 + b"\xff\xd9"
    await alice.post(
        f"/api/books/{book_id}/pages", files={"image": ("p.jpg", img_bytes, "image/jpeg")}, data={"seq": "0"}
    )

    ocr = FakeOcr({img_bytes: PageText(paragraphs=["Nội dung chạy nền."], continues_on_next_page=False)})
    tts = FakeTts()
    worker = _worker(app, ocr, {"gemini": tts})
    await worker.start()
    try:
        worker.wake()
        for _ in range(200):
            chunks = await ctx.chunks.list_for_book(book_id)
            if chunks and all(c.status == "done" for c in chunks):
                break
            await asyncio.sleep(0.02)
        else:
            raise AssertionError("background worker did not finish in time")
    finally:
        await worker.stop()

    chunks = await ctx.chunks.list_for_book(book_id)
    assert len(chunks) == 1 and chunks[0].status == "done"
    assert tts.calls == [("Nội dung chạy nền.", ctx.settings.gemini_tts_voice)]


async def test_missing_seq_blocks_until_uploaded_or_discarded(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    p1 = await ctx.pages.create(book.id, 1, "/fake/p1.jpg", "image/jpeg", None)
    p2 = await ctx.pages.create(book.id, 2, "/fake/p2.jpg", "image/jpeg", None)
    for p, text in ((p1, "Trang hai."), (p2, "Trang ba.")):
        await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p.id,))
        assert await ctx.pages.mark_ocr_done(p.id, text, False)
    worker = _worker(app, FakeOcr({}), {})
    await worker.chunk_tick()
    assert await ctx.chunks.list_for_book(book.id) == []

    detail = (await alice.get(f"/api/books/{book.id}")).json()
    assert detail["pages"]["missing_seqs"] == [0] and detail["pages"]["blocked_at_seq"] == 0
    assert detail["state"] == "failed"
    assert (await alice.post(f"/api/books/{book.id}/pages/5/discard")).status_code == 409  # would open a gap
    assert (await alice.post(f"/api/books/{book.id}/pages/1/discard")).status_code == 409  # ocr_done: not discardable
    r = await alice.post(f"/api/books/{book.id}/pages/0/discard")
    assert r.status_code == 200 and r.json()["status"] == "discarded"
    await worker.chunk_tick()
    texts = [c.text for c in await ctx.chunks.list_for_book(book.id)]
    assert texts == ["Trang hai.\nTrang ba."]
    detail = (await alice.get(f"/api/books/{book.id}")).json()
    assert detail["pages"]["missing_seqs"] == [] and detail["pages"]["blocked_at_seq"] is None


async def test_tail_claimed_by_tts_is_sealed_and_later_pages_start_new_chunk(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    tts = FakeTts()
    worker = _worker(app, FakeOcr({}), {"gemini": tts})
    p0 = await ctx.pages.create(book.id, 0, "/fake/p0.jpg", "image/jpeg", None)
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p0.id,))
    assert await ctx.pages.mark_ocr_done(p0.id, "Trang một kết thúc.", False)
    await worker.chunk_tick()
    assert await worker.claim_and_process_chunk()  # grace 0: the unsealed tail is spoken
    first = await ctx.chunks.list_for_book(book.id)
    assert [(c.status, c.sealed) for c in first] == [("done", 1)]

    p1 = await ctx.pages.create(book.id, 1, "/fake/p1.jpg", "image/jpeg", None)
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p1.id,))
    assert await ctx.pages.mark_ocr_done(p1.id, "Trang hai thêm sau.", False)
    await worker.chunk_tick()
    chunks = await ctx.chunks.list_for_book(book.id)
    assert [c.text for c in chunks] == ["Trang một kết thúc.", "Trang hai thêm sau."]
    assert (await ctx.pages.get(p1.id)).chunked == 1


async def test_stale_tts_result_after_voice_change_is_discarded(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    release = asyncio.Event()

    class SlowTts(FakeTts):
        async def synthesize(self, text, voice):
            if voice == ctx.settings.gemini_tts_voice:
                await release.wait()
            return await super().synthesize(text, voice)

    tts = SlowTts()
    worker = _worker(app, FakeOcr({}), {"gemini": tts})
    p0 = await ctx.pages.create(book.id, 0, "/fake/p0.jpg", "image/jpeg", None)
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p0.id,))
    assert await ctx.pages.mark_ocr_done(p0.id, "Một đoạn.", False)
    await worker.chunk_tick()
    stale = asyncio.create_task(worker.claim_and_process_chunk())
    await asyncio.sleep(0.05)
    await ctx.books.change_voice(book.id, "gemini", "Puck")
    assert await worker.claim_and_process_chunk()  # new run with Puck completes first
    release.set()
    await stale

    (chunk,) = await ctx.chunks.list_for_book(book.id)
    assert chunk.status == "done" and chunk.voice == "Puck"
    files = list((ctx.settings.library_dir / book.id).glob("*.mp3"))
    assert [f.name for f in files] == [chunk.audio_path.replace("\\", "/").split("/")[-1]]
    assert files[0].read_bytes() == b"MP3[M\xe1\xbb\x99t \xc4\x91o\xe1\xba\xa1n.]"


async def test_discard_next_seq_before_later_pages_arrive(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    p0 = await ctx.pages.create(book.id, 0, "/fake/p0.jpg", "image/jpeg", None)
    r = await alice.post(f"/api/books/{book.id}/pages/1/discard")
    assert r.status_code == 200 and r.json()["seq"] == 1
    detail = (await alice.get(f"/api/books/{book.id}")).json()
    assert detail["pages"]["next_seq"] == 2 and detail["pages"]["missing_seqs"] == []
    assert p0.seq == 0


async def test_discard_rejects_negative_seq(alice, app):
    book = await _make_book(app)
    assert (await alice.post(f"/api/books/{book.id}/pages/-1/discard")).status_code == 400
