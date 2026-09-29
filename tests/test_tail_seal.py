"""Tail-chunk waiting state, user seal-tail, and the chunker's guard against rewriting a sealed tail.

The unsealed tail is the only chunk the chunker may rewrite; TTS waits for it until the book
has been idle for the grace period (see app/pipeline/worker.py docstring). These tests pin that
rule, the `queued`/`tail_waiting` counters the progress UI relies on, and the seal-tail shortcut.
"""

from datetime import timedelta

import pytest

from app.db import now_iso
from app.pipeline.chunker_worker import chunk_tick
from app.repositories.chunk_repository import TailBusyError
from app.repositories.row_mapping import new_id
from tests.conftest import ctx_of
from tests.test_books_api import create_book, upload


async def insert_chunk(app, book_id: str, seq: int, *, status: str = "pending", sealed: int = 1, text: str | None = None) -> str:
    chunk_id = new_id()
    await ctx_of(app).db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, status, sealed, updated_at) VALUES (?,?,?,?,?,?,?)",
        (chunk_id, book_id, seq, text or f"Đoạn {seq}.", status, sealed, now_iso()),
    )
    return chunk_id


async def age_book(app, book_id: str, seconds: float) -> None:
    await ctx_of(app).db.execute("UPDATE books SET updated_at=? WHERE id=?", (now_iso(-timedelta(seconds=seconds)), book_id))


async def claim(app, grace_seconds: float):
    return await ctx_of(app).chunks.claim_next_pending(["gemini"], now_iso(), now_iso(-timedelta(seconds=grace_seconds)))


# --- current behaviour, pinned before the change -------------------------------------------


async def test_unsealed_tail_not_claimed_before_grace(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=0)
    assert await claim(app, grace_seconds=3600) is None


async def test_unsealed_tail_claimed_after_grace(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=0)
    await age_book(app, book["id"], 120)
    chunk = await claim(app, grace_seconds=90)
    assert chunk is not None and chunk.seq == 0


# --- queued / tail_waiting counters ---------------------------------------------------------


async def test_empty_book_has_no_tail_waiting(alice):
    book = await create_book(alice)
    assert book["chunks"]["queued"] == 0
    assert book["chunks"]["tail_waiting"] is False
    assert book["chunks"]["tail_wait_seconds"] is None


async def test_sealed_chunks_count_as_queued_not_tail_waiting(alice, app):
    book = await create_book(alice)
    for seq in range(3):
        await insert_chunk(app, book["id"], seq, sealed=1)
    await insert_chunk(app, book["id"], 3, sealed=0)
    got = (await alice.get(f"/api/books/{book['id']}")).json()["chunks"]
    assert got["queued"] == 3
    assert got["tail_waiting"] is False
    assert got["tail_wait_seconds"] is None


async def test_only_tail_left_is_tail_waiting_with_countdown(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, status="done", sealed=1)
    await insert_chunk(app, book["id"], 1, sealed=0)
    grace = ctx_of(app).settings.tail_seal_grace_seconds
    got = (await alice.get(f"/api/books/{book['id']}")).json()["chunks"]
    assert got["queued"] == 0
    assert got["tail_waiting"] is True
    assert 0 <= got["tail_wait_seconds"] <= grace
    listed = next(b for b in (await alice.get("/api/books")).json() if b["id"] == book["id"])
    assert listed["chunks"]["tail_waiting"] is True


async def test_tail_wait_seconds_never_negative(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=0)
    await age_book(app, book["id"], 10_000)
    got = (await alice.get(f"/api/books/{book['id']}")).json()["chunks"]
    assert got["tail_waiting"] is True and got["tail_wait_seconds"] == 0


async def test_page_still_uploaded_is_not_tail_waiting(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=0)
    assert (await upload(alice, book["id"], seq=0)).status_code == 202
    got = (await alice.get(f"/api/books/{book['id']}")).json()["chunks"]
    assert got["tail_waiting"] is False


# --- seal-tail endpoint ---------------------------------------------------------------------


async def test_seal_tail_lets_worker_claim_immediately(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=0)
    assert (await alice.post(f"/api/books/{book['id']}/seal-tail")).status_code == 204
    chunk = await claim(app, grace_seconds=3600)
    assert chunk is not None and chunk.seq == 0
    got = (await alice.get(f"/api/books/{book['id']}")).json()["chunks"]
    assert got["tail_waiting"] is False


async def test_seal_tail_is_idempotent_and_open_to_every_member(alice, bob, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=0)
    assert (await bob.post(f"/api/books/{book['id']}/seal-tail")).status_code == 204
    assert (await alice.post(f"/api/books/{book['id']}/seal-tail")).status_code == 204


async def test_seal_tail_unknown_book_and_anonymous(alice, anon):
    assert (await alice.post("/api/books/nope/seal-tail")).status_code == 404
    assert (await anon.post("/api/books/nope/seal-tail")).status_code == 401


# --- chunker guard: never rewrite a tail that was sealed meanwhile ----------------------------


@pytest.mark.parametrize("seal", ["user_seal", "user_edit"])
async def test_replace_tail_refuses_a_tail_sealed_after_it_was_read(alice, app, seal):
    ctx = ctx_of(app)
    book = await create_book(alice)
    chunk_id = await insert_chunk(app, book["id"], 0, sealed=0, text="Bản gốc.")
    tail = await ctx.chunks.get_unsealed_tail(book["id"])
    assert tail is not None

    if seal == "user_seal":
        await ctx.chunks.seal_tail(book["id"])
        expected = "Bản gốc."
    else:
        await ctx.chunks.update_text(chunk_id, "Bản đã sửa tay.")
        expected = "Bản đã sửa tay."

    with pytest.raises(TailBusyError):
        await ctx.chunks.replace_tail(book["id"], tail, tail.seq, ["Bản gốc. Trang mới."])
    row = await ctx.db.fetchone("SELECT text, sealed FROM chunks WHERE id=?", (chunk_id,))
    assert row["text"] == expected and row["sealed"] == 1


async def add_ocr_page(app, book_id: str, seq: int, text: str) -> None:
    ctx = ctx_of(app)
    page = await ctx.pages.create(book_id, seq, f"/fake/p{seq}.jpg", "image/jpeg", None)
    await ctx.db.execute("UPDATE pages SET status='ocr_processing' WHERE id=?", (page.id,))
    assert await ctx.pages.mark_ocr_done(page.id, text, False)


async def test_seal_tail_then_new_page_lands_in_new_chunk(alice, app):
    ctx = ctx_of(app)
    book = await create_book(alice)
    await add_ocr_page(app, book["id"], 0, "Nội dung trang một.")
    await chunk_tick(ctx)
    [tail] = await ctx.chunks.list_for_book(book["id"])
    assert tail.sealed == 0 and tail.text == "Nội dung trang một."

    assert (await alice.post(f"/api/books/{book['id']}/seal-tail")).status_code == 204

    await add_ocr_page(app, book["id"], 1, "Nội dung trang hai.")
    await chunk_tick(ctx)
    chunks = await ctx.chunks.list_for_book(book["id"])
    assert [c.seq for c in chunks] == [tail.seq, tail.seq + 1]
    assert chunks[0].text == "Nội dung trang một." and chunks[0].sealed == 1
    assert chunks[1].text == "Nội dung trang hai." and chunks[1].sealed == 0


# --- default voice --------------------------------------------------------------------------


async def test_new_book_defaults_to_charon(alice):
    assert (await create_book(alice))["tts_voice"] == "Charon"
