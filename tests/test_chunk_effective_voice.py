"""The voice a chunk reports is the one its audio has or will have.

`chunks.voice` is only a snapshot taken when the worker claims a chunk, so for a chunk without
audio it can be stale (claimed before a voice change, then parked on quota or failed) or empty
(never claimed). The API must report the book's current voice for those, since the next claim
copies it; only `done`/`processing` chunks report their own snapshot.
"""

from datetime import timedelta

from app.db import now_iso
from tests.conftest import ctx_of
from tests.test_books_api import create_book, insert_done_chunk
from tests.test_tail_seal import claim, insert_chunk

NEW_VOICE = {"tts_provider": "gemini", "tts_voice": "Orus"}


async def api_chunk(client, book_id: str, chunk_id: str) -> dict:
    chunks = (await client.get(f"/api/books/{book_id}/chunks")).json()
    return next(c for c in chunks if c["id"] == chunk_id)


async def claimed_chunk(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=1)
    chunk = await claim(app, grace_seconds=3600)
    assert chunk is not None and chunk.voice == book["tts_voice"] != NEW_VOICE["tts_voice"]
    return book, chunk


# --- chunks with audio, or being synthesized, report their own voice ----------------------


async def test_done_chunk_reports_its_own_voice_after_voice_change(alice, app):
    book = await create_book(alice)
    done = await insert_done_chunk(app, book["id"], 0)
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    out = await api_chunk(alice, book["id"], done["id"])
    assert (out["status"], out["provider"], out["voice"]) == ("done", "gemini", "Kore")


async def test_processing_chunk_reports_claimed_voice(alice, app):
    book, chunk = await claimed_chunk(alice, app)
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    out = await api_chunk(alice, book["id"], chunk.id)
    assert (out["status"], out["voice"]) == ("processing", chunk.voice)


# --- chunks without audio report the book's current voice ------------------------------------


async def test_waiting_quota_chunk_reports_book_voice(alice, app):
    book, chunk = await claimed_chunk(alice, app)
    assert await ctx_of(app).chunks.mark_waiting_quota(chunk, now_iso(timedelta(hours=1)), "quota")
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    out = await api_chunk(alice, book["id"], chunk.id)
    assert (out["status"], out["provider"], out["voice"]) == ("waiting_quota", "gemini", "Orus")


async def test_requeued_chunk_reports_book_voice(alice, app):
    book, chunk = await claimed_chunk(alice, app)
    chunks = ctx_of(app).chunks
    assert await chunks.mark_waiting_quota(chunk, now_iso(-timedelta(seconds=1)), "quota")
    assert await chunks.requeue_expired_quota(now_iso()) == 1
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    out = await api_chunk(alice, book["id"], chunk.id)
    assert (out["status"], out["voice"]) == ("pending", "Orus")


async def test_never_claimed_chunk_reports_book_voice(alice, app):
    book = await create_book(alice)
    chunk_id = await insert_chunk(app, book["id"], 0, sealed=1)
    out = await api_chunk(alice, book["id"], chunk_id)
    assert (out["status"], out["provider"], out["voice"]) == ("pending", book["tts_provider"], book["tts_voice"])


async def test_failed_chunk_reports_book_voice(alice, app):
    book, chunk = await claimed_chunk(alice, app)
    assert await ctx_of(app).chunks.mark_failed(chunk, "boom")
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    out = await api_chunk(alice, book["id"], chunk.id)
    assert (out["status"], out["voice"]) == ("failed", "Orus")


async def test_retry_endpoint_reports_book_voice(alice, app):
    book, chunk = await claimed_chunk(alice, app)
    assert await ctx_of(app).chunks.mark_failed(chunk, "boom")
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    r = await alice.post(f"/api/chunks/{chunk.id}/retry")
    assert r.status_code == 200 and (r.json()["status"], r.json()["voice"]) == ("pending", "Orus")


async def test_patch_endpoint_reports_book_voice(alice, app):
    book, chunk = await claimed_chunk(alice, app)
    assert await ctx_of(app).chunks.mark_failed(chunk, "boom")
    await alice.put(f"/api/books/{book['id']}/voice", json=NEW_VOICE)
    r = await alice.patch(f"/api/chunks/{chunk.id}", json={"text": "Đoạn đã sửa."})
    assert r.status_code == 200 and (r.json()["status"], r.json()["voice"]) == ("pending", "Orus")


async def test_chunk_response_is_404_when_book_vanished_meanwhile(alice, app, monkeypatch):
    book, chunk = await claimed_chunk(alice, app)
    assert await ctx_of(app).chunks.mark_failed(chunk, "boom")

    async def gone(_book_id):
        return None

    monkeypatch.setattr(ctx_of(app).books, "get", gone)
    r = await alice.post(f"/api/chunks/{chunk.id}/retry")
    assert r.status_code == 404
