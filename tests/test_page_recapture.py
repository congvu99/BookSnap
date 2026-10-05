"""Recapture a failed page: a new image replaces the failed one in place, keeping its seq,
so the page re-enters OCR and joins the chunks in its original position."""

from pathlib import Path

from app.pipeline.ocr_provider import PageText
from tests.conftest import TINY_JPEG, ctx_of
from tests.test_worker_resume import FakeOcr, _make_book, _worker

NEW_JPEG = b"\xff\xd8\xff\xe1" + b"\x01" * 64 + b"\xff\xd9"
TINY_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def _upload(client, book_id: str, seq: int, data: bytes = TINY_JPEG):
    r = await client.post(f"/api/books/{book_id}/pages", files={"image": ("p.jpg", data, "image/jpeg")}, data={"seq": str(seq)})
    assert r.status_code == 202, r.text
    return r.json()


async def _replace(client, page_id: str, data: bytes = NEW_JPEG, mime: str = "image/jpeg"):
    return await client.post(f"/api/pages/{page_id}/image", files={"image": ("p.jpg", data, mime)})


async def _fail(app, page_id: str, *, drop_image: bool = False) -> None:
    sql = "UPDATE pages SET status='failed', error='Ảnh mờ', attempts=3" + (", image_path=NULL" if drop_image else "") + " WHERE id=?"
    await ctx_of(app).db.execute(sql, (page_id,))


def _tmp_files(app) -> set[str]:
    tmp_dir = ctx_of(app).settings.tmp_dir
    return {p.name for p in tmp_dir.iterdir()} if tmp_dir.exists() else set()


async def test_replace_image_resets_failed_page_keeping_seq(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    uploaded = await _upload(alice, book.id, 0)
    old_path = (await ctx.pages.get(uploaded["id"])).image_path
    await _fail(app, uploaded["id"])

    r = await _replace(alice, uploaded["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == uploaded["id"] and body["seq"] == 0
    assert body["status"] == "uploaded" and body["error"] is None

    page = await ctx.pages.get(uploaded["id"])
    assert page.attempts == 0 and page.image_mime == "image/jpeg"
    assert page.image_path != old_path and Path(page.image_path).read_bytes() == NEW_JPEG
    assert not Path(old_path).exists()


async def test_replace_image_works_after_original_expired(alice, app):
    book = await _make_book(app)
    uploaded = await _upload(alice, book.id, 0)
    await _fail(app, uploaded["id"], drop_image=True)

    r = await _replace(alice, uploaded["id"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "uploaded"


async def test_replace_image_rejects_non_failed_page(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    uploaded = await _upload(alice, book.id, 0)
    for status in ("uploaded", "ocr_processing", "ocr_done", "discarded"):
        await ctx.db.execute("UPDATE pages SET status=? WHERE id=?", (status, uploaded["id"]))
        before = _tmp_files(app)
        r = await _replace(alice, uploaded["id"])
        assert r.status_code == 409 and r.json()["error"]["code"] == "page_not_replaceable", (status, r.text)
        assert _tmp_files(app) == before  # the rejected image left no orphan behind


async def test_replace_image_validates_image(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    uploaded = await _upload(alice, book.id, 0)
    await _fail(app, uploaded["id"])

    r = await _replace(alice, uploaded["id"], TINY_PNG, "image/jpeg")
    assert r.status_code == 415
    ctx.settings.max_upload_bytes = 16
    r = await _replace(alice, uploaded["id"])
    assert r.status_code == 413
    assert (await ctx.pages.get(uploaded["id"])).status == "failed"


async def test_cleanup_expiry_never_clears_a_recaptured_image(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    uploaded = await _upload(alice, book.id, 0)
    await _fail(app, uploaded["id"])
    # Cleanup listed the page as expired, then a recapture committed before it cleared the path.
    (stale,) = await ctx.pages.list_failed_with_expired_image("9999-12-31T00:00:00+00:00")
    assert (await _replace(alice, uploaded["id"])).status_code == 200
    await ctx.pages.clear_image(stale.id, stale.image_path)

    page = await ctx.pages.get(uploaded["id"])
    assert page.status == "uploaded" and Path(page.image_path).read_bytes() == NEW_JPEG


async def test_replace_image_unknown_page_404(alice):
    r = await _replace(alice, "missing-page")
    assert r.status_code == 404


async def test_recaptured_page_rejoins_chunks_in_order(alice, app):
    ctx = ctx_of(app)
    book = await _make_book(app)
    p0 = await _upload(alice, book.id, 0)
    p1 = await _upload(alice, book.id, 1)
    await _fail(app, p0["id"])
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (p1["id"],))
    assert await ctx.pages.mark_ocr_done(p1["id"], "Trang hai.", False)

    ocr = FakeOcr({NEW_JPEG: PageText(paragraphs=["Trang một chụp lại."], continues_on_next_page=False)})
    worker = _worker(app, ocr, {})
    await worker.chunk_tick()
    assert await ctx.chunks.list_for_book(book.id) == []  # the failed page still blocks page two

    assert (await _replace(alice, p0["id"])).status_code == 200
    assert await worker.claim_and_process_page()
    await worker.chunk_tick()

    chunks = await ctx.chunks.list_for_book(book.id)
    assert len(chunks) == 1 and chunks[0].text == "Trang một chụp lại.\nTrang hai."
