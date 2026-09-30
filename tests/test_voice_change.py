"""Choosing a book's voice: validation, the new-content-only switch, and SSML escaping.

`PUT /api/books/{id}/voice` switches the voice without re-queueing audio that already exists.
It is a separate endpoint (not a PATCH flag) so that an older server, which ignores unknown
PATCH fields, can never mistake it for a full regeneration.
"""

import xml.etree.ElementTree as ET
from datetime import timedelta

import pytest

from app.db import now_iso
from app.pipeline.tts_azure import _build_ssml
from tests.conftest import ctx_of
from tests.test_books_api import create_book, insert_done_chunk
from tests.test_tail_seal import claim, insert_chunk


@pytest.fixture
def azure_configured(app, monkeypatch):
    monkeypatch.setattr(ctx_of(app).settings, "azure_speech_key", "test-key")


async def book_row(app, book_id):
    return await ctx_of(app).db.fetchone("SELECT tts_provider, tts_voice, updated_at FROM books WHERE id=?", (book_id,))


async def test_set_voice_keeps_done_audio_and_does_not_touch_updated_at(alice, app):
    book = await create_book(alice)
    chunk = await insert_done_chunk(app, book["id"], 0)
    before = await book_row(app, book["id"])

    r = await alice.put(f"/api/books/{book['id']}/voice", json={"tts_provider": "gemini", "tts_voice": "Orus"})

    assert r.status_code == 200 and r.json()["tts_voice"] == "Orus"
    chunks = (await alice.get(f"/api/books/{book['id']}/chunks")).json()
    assert chunks[0]["status"] == "done" and chunks[0]["voice"] == "Kore" and chunks[0]["audio_url"]
    assert chunk["path"].exists()
    assert (await book_row(app, book["id"]))["updated_at"] == before["updated_at"], "must not restart the tail grace period"


async def test_set_voice_applies_to_chunks_claimed_afterwards(alice, app):
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=1)
    await alice.put(f"/api/books/{book['id']}/voice", json={"tts_provider": "gemini", "tts_voice": "Orus"})
    claimed = await claim(app, grace_seconds=3600)
    assert claimed is not None and claimed.voice == "Orus"


async def test_set_voice_validation_and_ownership(alice, bob, app):
    book = await create_book(alice)
    url = f"/api/books/{book['id']}/voice"
    assert (await bob.put(url, json={"tts_provider": "gemini", "tts_voice": "Orus"})).status_code == 403
    bad = await alice.put(url, json={"tts_provider": "gemini", "tts_voice": "NotAVoice"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "unknown_voice"
    unconfigured = await alice.put(url, json={"tts_provider": "azure", "tts_voice": "vi-VN-NamMinhNeural"})
    assert unconfigured.status_code == 409 and unconfigured.json()["error"]["code"] == "provider_unavailable"
    assert (await alice.put("/api/books/nope/voice", json={"tts_provider": "gemini", "tts_voice": "Orus"})).status_code == 404


async def test_set_voice_to_configured_azure(alice, app, azure_configured):
    book = await create_book(alice)
    r = await alice.put(f"/api/books/{book['id']}/voice", json={"tts_provider": "azure", "tts_voice": "vi-VN-NamMinhNeural"})
    assert r.status_code == 200 and r.json()["tts_provider"] == "azure"


async def test_create_book_rejects_unknown_voice_and_unconfigured_provider(alice):
    bad = await alice.post("/api/books", json={"title": "Sách", "tts_voice": "Kore\"/><x"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "unknown_voice"
    unconfigured = await alice.post("/api/books", json={"title": "Sách", "tts_provider": "azure"})
    assert unconfigured.status_code == 409


async def test_create_book_with_chosen_voice(alice):
    book = await create_book(alice, tts_provider="gemini", tts_voice="Orus")
    assert book["tts_voice"] == "Orus"


async def test_patch_voice_still_regenerates_but_rejects_unknown_voice(alice, app):
    book = await create_book(alice)
    r = await alice.patch(f"/api/books/{book['id']}", json={"tts_voice": "NotAVoice"})
    assert r.status_code == 400


async def test_patch_with_invalid_voice_changes_nothing(alice, app):
    book = await create_book(alice)
    r = await alice.patch(f"/api/books/{book['id']}", json={"title": "Mới", "tts_voice": "NotAVoice"})
    assert r.status_code == 400
    after = (await alice.get(f"/api/books/{book['id']}")).json()
    assert after["title"] == book["title"] and after["updated_at"] == book["updated_at"]


async def test_set_voice_to_current_voice_skips_validation(alice, app):
    book = await create_book(alice)
    await ctx_of(app).db.execute("UPDATE books SET tts_provider='azure', tts_voice='vi-VN-NamMinhNeural' WHERE id=?", (book["id"],))
    r = await alice.put(f"/api/books/{book['id']}/voice", json={"tts_provider": "azure", "tts_voice": "vi-VN-NamMinhNeural"})
    assert r.status_code == 200, "unconfigured provider is fine when nothing changes"


async def test_voices_reports_configured_per_provider(alice, app, azure_configured):
    body = (await alice.get("/api/voices")).json()
    assert body["providers"]["azure"]["configured"] is True
    assert body["providers"]["gemini"]["configured"] is bool(ctx_of(app).settings.gemini_api_key)
    assert "Charon" in body["providers"]["gemini"]["voices"]


def test_ssml_escapes_voice_attribute():
    ssml = _build_ssml("Xin chào <b>", 'x" onload="y')
    voice = ET.fromstring(ssml).find("{http://www.w3.org/2001/10/synthesis}voice")
    assert voice is not None and voice.get("name") == 'x" onload="y' and voice.get("onload") is None
    assert voice.text == "Xin chào <b>"


# --- quota waits when the voice changes -------------------------------------------------------

AZURE_VOICE = {"tts_provider": "azure", "tts_voice": "vi-VN-NamMinhNeural"}


async def chunk_row(app, chunk_id):
    return await ctx_of(app).db.fetchone("SELECT status, not_before, error FROM chunks WHERE id=?", (chunk_id,))


async def parked_on_quota(alice, app):
    """A chunk claimed with the book's Gemini voice, then parked on a quota error for an hour."""
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=1)
    chunk = await claim(app, grace_seconds=3600)
    assert chunk is not None
    assert await ctx_of(app).chunks.mark_waiting_quota(chunk, now_iso(timedelta(hours=1)), "Hết quota")
    return book, chunk


async def test_set_voice_same_provider_keeps_quota_wait(alice, app):
    book, chunk = await parked_on_quota(alice, app)
    before = await chunk_row(app, chunk.id)
    await alice.put(f"/api/books/{book['id']}/voice", json={"tts_provider": "gemini", "tts_voice": "Orus"})
    assert dict(await chunk_row(app, chunk.id)) == dict(before), "same key, same quota: retrying now would only fail again"


async def test_set_voice_new_provider_requeues_quota_wait(alice, app, azure_configured):
    book, chunk = await parked_on_quota(alice, app)
    await alice.put(f"/api/books/{book['id']}/voice", json=AZURE_VOICE)
    assert tuple(await chunk_row(app, chunk.id)) == ("pending", None, None)
    out = next(c for c in (await alice.get(f"/api/books/{book['id']}/chunks")).json() if c["id"] == chunk.id)
    assert (out["provider"], out["voice"]) == ("azure", "vi-VN-NamMinhNeural")


async def test_set_voice_new_provider_leaves_other_statuses(alice, app, azure_configured):
    book, waiting = await parked_on_quota(alice, app)
    done = await insert_done_chunk(app, book["id"], 1)
    failed_id = await insert_chunk(app, book["id"], 2, status="failed")
    other_book, other_waiting = await parked_on_quota(alice, app)
    before = await book_row(app, book["id"])

    await alice.put(f"/api/books/{book['id']}/voice", json=AZURE_VOICE)

    assert (await chunk_row(app, waiting.id))["status"] == "pending"
    assert (await chunk_row(app, done["id"]))["status"] == "done"
    assert (await chunk_row(app, failed_id))["status"] == "failed"
    assert (await chunk_row(app, other_waiting.id))["status"] == "waiting_quota", "other books keep waiting"
    assert (await book_row(app, book["id"]))["updated_at"] == before["updated_at"], "must not restart the tail grace period"


async def test_requeued_chunk_claimable_by_new_provider(alice, app, azure_configured):
    book, chunk = await parked_on_quota(alice, app)
    await alice.put(f"/api/books/{book['id']}/voice", json=AZURE_VOICE)
    claimed = await ctx_of(app).chunks.claim_next_pending(["azure"], now_iso(), now_iso(-timedelta(hours=1)))
    assert claimed is not None and claimed.id == chunk.id
    assert (claimed.provider, claimed.voice) == ("azure", "vi-VN-NamMinhNeural")


async def test_quota_on_old_provider_after_switch_does_not_park_chunk(alice, app, azure_configured):
    """The chunk in flight when the user switches provider is the one that gets the old provider's 429."""
    book = await create_book(alice)
    await insert_chunk(app, book["id"], 0, sealed=1)
    in_flight = await claim(app, grace_seconds=3600)
    assert in_flight is not None and in_flight.provider == "gemini"
    await alice.put(f"/api/books/{book['id']}/voice", json=AZURE_VOICE)

    assert await ctx_of(app).chunks.mark_waiting_quota(in_flight, now_iso(timedelta(hours=1)), "Hết quota")

    assert tuple(await chunk_row(app, in_flight.id)) == ("pending", None, None)
    claimed = await ctx_of(app).chunks.claim_next_pending(["azure"], now_iso(), now_iso(-timedelta(hours=1)))
    assert claimed is not None and claimed.id == in_flight.id


async def test_quota_on_current_provider_still_parks_chunk(alice, app):
    book, chunk = await parked_on_quota(alice, app)
    row = await chunk_row(app, chunk.id)
    assert row["status"] == "waiting_quota" and row["not_before"] and row["error"] == "Hết quota"


async def test_set_voice_releases_chunks_parked_on_another_provider(alice, app, azure_configured):
    """Also covers chunks left parked on the old provider by a switch made before this rule existed."""
    book, chunk = await parked_on_quota(alice, app)
    await ctx_of(app).db.execute("UPDATE books SET tts_provider='azure', tts_voice='vi-VN-HoaiMyNeural' WHERE id=?", (book["id"],))
    await alice.put(f"/api/books/{book['id']}/voice", json=AZURE_VOICE)
    assert tuple(await chunk_row(app, chunk.id)) == ("pending", None, None)
