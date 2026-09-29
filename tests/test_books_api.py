from pathlib import Path

import pytest

from app.db import now_iso
from app.repositories.row_mapping import new_id
from tests.conftest import TINY_JPEG, ctx_of

PNG_HEAD = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def create_book(client, title="Dế Mèn phiêu lưu ký", **extra) -> dict:
    r = await client.post("/api/books", json={"title": title, **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def upload(client, book_id, seq=0, data=TINY_JPEG, mime="image/jpeg", upload_id=None):
    form = {"seq": str(seq)}
    if upload_id:
        form["upload_id"] = upload_id
    return await client.post(f"/api/books/{book_id}/pages", files={"image": ("p.jpg", data, mime)}, data=form)


async def insert_done_chunk(app, book_id: str, seq: int, audio_bytes: bytes = b"ID3" + bytes(range(256)) * 8) -> dict:
    ctx = ctx_of(app)
    chunk_id = new_id()
    audio_dir = ctx.settings.library_dir / book_id
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / f"{seq:05d}-abcdef12.mp3"
    audio_path.write_bytes(audio_bytes)
    await ctx.db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, content_hash, status, provider, voice, audio_path, duration_ms, updated_at)"
        " VALUES (?,?,?,?,?,'done','gemini','Kore',?,?,?)",
        (chunk_id, book_id, seq, f"Đoạn {seq}.", "abcdef1234", str(audio_path), 1000, now_iso()),
    )
    return {"id": chunk_id, "path": audio_path, "bytes": audio_bytes}


async def test_create_list_get_book_with_defaults(alice, app):
    book = await create_book(alice)
    assert book["tts_provider"] == "gemini"
    assert book["tts_voice"] == ctx_of(app).settings.gemini_tts_voice
    assert book["can_manage"] is True and book["created_by_name"] == "Alice Nguyễn"
    assert book["state"] == "empty" and book["pages"]["next_seq"] == 0
    listed = (await alice.get("/api/books")).json()
    assert [b["id"] for b in listed] == [book["id"]]
    assert (await alice.get(f"/api/books/{book['id']}")).json()["title"] == "Dế Mèn phiêu lưu ký"


async def test_create_book_with_azure_uses_azure_default_voice(alice, app):
    book = await create_book(alice, tts_provider="azure")
    assert book["tts_voice"] == ctx_of(app).settings.azure_tts_voice


@pytest.mark.parametrize("body", [{"title": "  "}, {"title": "x" * 121}, {"title": "ok", "tts_provider": "polly"}])
async def test_create_book_validation(alice, body):
    assert (await alice.post("/api/books", json=body)).status_code == 400


async def test_get_unknown_book_404(alice):
    assert (await alice.get("/api/books/nope")).status_code == 404


async def test_shared_library_but_only_owner_manages(alice, bob):
    book = await create_book(alice)
    seen_by_bob = (await bob.get("/api/books")).json()
    assert seen_by_bob[0]["id"] == book["id"] and seen_by_bob[0]["can_manage"] is False
    assert (await bob.patch(f"/api/books/{book['id']}", json={"title": "Hack"})).status_code == 403
    assert (await bob.patch(f"/api/books/{book['id']}", json={"tts_provider": "azure"})).status_code == 403
    assert (await bob.delete(f"/api/books/{book['id']}")).status_code == 403
    assert (await upload(bob, book["id"], seq=0)).status_code == 202


async def test_patch_title_and_voice_resets_chunks(alice, app):
    book = await create_book(alice)
    chunk = await insert_done_chunk(app, book["id"], 0)
    r = await alice.patch(f"/api/books/{book['id']}", json={"title": "Tên mới", "tts_provider": "azure"})
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Tên mới" and body["tts_provider"] == "azure"
    assert body["tts_voice"] == ctx_of(app).settings.azure_tts_voice
    chunks = (await alice.get(f"/api/books/{book['id']}/chunks")).json()
    assert chunks[0]["status"] == "pending" and chunks[0]["audio_url"] is None
    assert chunk["path"].exists(), "old audio kept until the worker replaces it"


async def test_patch_same_voice_does_not_reset(alice, app):
    book = await create_book(alice)
    await insert_done_chunk(app, book["id"], 0)
    await alice.patch(f"/api/books/{book['id']}", json={"tts_provider": "gemini"})
    chunks = (await alice.get(f"/api/books/{book['id']}/chunks")).json()
    assert chunks[0]["status"] == "done"


async def test_upload_page_valid(alice, app):
    book = await create_book(alice)
    r = await upload(alice, book["id"], seq=0)
    assert r.status_code == 202
    page = r.json()
    assert page["status"] == "uploaded" and page["seq"] == 0
    stored = await ctx_of(app).pages.get(page["id"])
    assert Path(stored.image_path).read_bytes() == TINY_JPEG
    assert Path(stored.image_path).parent == ctx_of(app).settings.tmp_dir
    detail = (await alice.get(f"/api/books/{book['id']}")).json()
    assert detail["pages"]["next_seq"] == 1 and detail["state"] == "processing"
    assert [p["seq"] for p in detail["page_list"]] == [0]


async def test_upload_png_accepted(alice):
    book = await create_book(alice)
    assert (await upload(alice, book["id"], data=PNG_HEAD, mime="image/png")).status_code == 202


@pytest.mark.parametrize(
    "data,mime",
    [
        (b"GIF89a" + b"\x00" * 20, "image/gif"),
        (b"not an image at all", "image/jpeg"),
        (PNG_HEAD, "image/jpeg"),
        (TINY_JPEG, "application/octet-stream"),
    ],
)
async def test_upload_rejects_wrong_type(alice, data, mime):
    book = await create_book(alice)
    r = await upload(alice, book["id"], data=data, mime=mime)
    assert r.status_code == 415


async def test_upload_rejects_too_large(alice, app):
    ctx_of(app).settings.max_upload_bytes = 1024
    book = await create_book(alice)
    r = await upload(alice, book["id"], data=TINY_JPEG + b"\x00" * 2048)
    assert r.status_code == 413
    assert list(ctx_of(app).settings.tmp_dir.iterdir()) == []


async def test_upload_seq_conflict_and_idempotent_retry(alice, app):
    book = await create_book(alice)
    first = await upload(alice, book["id"], seq=3, upload_id="u-1")
    assert first.status_code == 202
    again = await upload(alice, book["id"], seq=3, upload_id="u-1")
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    clash = await upload(alice, book["id"], seq=3, upload_id="u-2")
    assert clash.status_code == 409
    assert len(list(ctx_of(app).settings.tmp_dir.iterdir())) == 1


async def test_upload_to_unknown_book_404(alice):
    assert (await upload(alice, "missing")).status_code == 404


async def test_page_retry_only_when_failed(alice, app):
    book = await create_book(alice)
    page = (await upload(alice, book["id"])).json()
    assert (await alice.post(f"/api/pages/{page['id']}/retry")).status_code == 409
    await ctx_of(app).db.execute("UPDATE pages SET status='failed', error='boom' WHERE id=?", (page["id"],))
    r = await alice.post(f"/api/pages/{page['id']}/retry")
    assert r.status_code == 200 and r.json()["status"] == "uploaded"


async def test_delete_book_removes_audio_and_temp_images(alice, app):
    book = await create_book(alice)
    page = (await upload(alice, book["id"])).json()
    image_path = Path((await ctx_of(app).pages.get(page["id"])).image_path)
    chunk = await insert_done_chunk(app, book["id"], 0)
    assert (await alice.delete(f"/api/books/{book['id']}")).status_code == 204
    assert not image_path.exists()
    assert not chunk["path"].exists()
    assert not (ctx_of(app).settings.library_dir / book["id"]).exists()
    assert (await alice.get(f"/api/books/{book['id']}")).status_code == 404
    assert await ctx_of(app).db.fetchall("SELECT * FROM chunks") == []


async def test_chunks_listing_and_audio_full_and_range(alice, app):
    book = await create_book(alice)
    chunk = await insert_done_chunk(app, book["id"], 0)
    listed = (await alice.get(f"/api/books/{book['id']}/chunks")).json()
    assert listed[0]["audio_url"].startswith(f"/api/chunks/{chunk['id']}/audio?v=")
    full = await alice.get(listed[0]["audio_url"])
    assert full.status_code == 200 and full.headers["content-type"] == "audio/mpeg"
    assert full.content == chunk["bytes"]
    assert full.headers.get("accept-ranges") == "bytes"
    part = await alice.get(listed[0]["audio_url"], headers={"Range": "bytes=10-19"})
    assert part.status_code == 206
    assert part.content == chunk["bytes"][10:20]
    assert part.headers["content-range"] == f"bytes 10-19/{len(chunk['bytes'])}"


async def test_audio_path_outside_library_is_refused(alice, app, tmp_path):
    book = await create_book(alice)
    chunk = await insert_done_chunk(app, book["id"], 0)
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    await ctx_of(app).db.execute("UPDATE chunks SET audio_path=? WHERE id=?", (str(secret), chunk["id"]))
    assert (await alice.get(f"/api/chunks/{chunk['id']}/audio")).status_code == 404
    await ctx_of(app).db.execute(
        "UPDATE chunks SET audio_path=? WHERE id=?", (str(ctx_of(app).settings.library_dir / ".." / "booksnap.db"), chunk["id"])
    )
    assert (await alice.get(f"/api/chunks/{chunk['id']}/audio")).status_code == 404


async def test_chunk_edit_and_retry(alice, app):
    book = await create_book(alice)
    chunk = await insert_done_chunk(app, book["id"], 0)
    r = await alice.patch(f"/api/chunks/{chunk['id']}", json={"text": "  Văn bản đã sửa.  "})
    assert r.status_code == 200
    assert r.json()["text"] == "Văn bản đã sửa." and r.json()["status"] == "pending"
    assert (await alice.patch(f"/api/chunks/{chunk['id']}", json={"text": " "})).status_code == 400
    assert (await alice.post(f"/api/chunks/{chunk['id']}/retry")).status_code == 409
    await ctx_of(app).db.execute("UPDATE chunks SET status='waiting_quota', not_before=? WHERE id=?", (now_iso(), chunk["id"]))
    retried = await alice.post(f"/api/chunks/{chunk['id']}/retry")
    assert retried.status_code == 200 and retried.json()["status"] == "pending" and retried.json()["not_before"] is None


async def test_progress_is_per_user(alice, bob):
    book = await create_book(alice)
    url = f"/api/books/{book['id']}/progress"
    assert (await alice.get(url)).json() == {"chunk_seq": 0, "offset_ms": 0, "updated_at": None}
    assert (await alice.put(url, json={"chunk_seq": 4, "offset_ms": 1200})).status_code == 200
    assert (await bob.put(url, json={"chunk_seq": 9, "offset_ms": 50})).status_code == 200
    a, b = (await alice.get(url)).json(), (await bob.get(url)).json()
    assert (a["chunk_seq"], a["offset_ms"]) == (4, 1200)
    assert (b["chunk_seq"], b["offset_ms"]) == (9, 50)
    listed_a = (await alice.get("/api/books")).json()[0]["progress"]
    assert listed_a["chunk_seq"] == 4
    assert (await alice.put(url, json={"chunk_seq": -1, "offset_ms": 0})).status_code == 400


async def test_continue_listening_is_per_user(alice, bob):
    b1 = await create_book(alice, title="Một")
    b2 = await create_book(alice, title="Hai")
    await alice.put(f"/api/books/{b1['id']}/progress", json={"chunk_seq": 1, "offset_ms": 0})
    await bob.put(f"/api/books/{b2['id']}/progress", json={"chunk_seq": 1, "offset_ms": 0})
    assert [b["id"] for b in (await alice.get("/api/me/continue")).json()] == [b1["id"]]
    assert [b["id"] for b in (await bob.get("/api/me/continue")).json()] == [b2["id"]]


async def test_health_and_static(anon):
    h = await anon.get("/health")
    assert h.status_code == 200 and h.json()["status"] == "ok"
    index = await anon.get("/")
    assert index.status_code == 200 and "text/html" in index.headers["content-type"]
    assert index.headers["cache-control"] == "no-cache"


async def test_voices_lists_defaults(alice, app):
    body = (await alice.get("/api/voices")).json()
    s = ctx_of(app).settings
    assert body["default_provider"] == s.tts_default_provider
    assert s.gemini_tts_voice in body["providers"]["gemini"]["voices"]
    assert body["providers"]["azure"]["default"] == s.azure_tts_voice


async def test_oversized_body_rejected_before_auth(anon, app):
    limit = ctx_of(app).settings.max_upload_bytes + 256 * 1024
    big = b"\xff\xd8\xff" + b"\x00" * (limit + 10)
    r = await anon.post("/api/books/x/pages", files={"image": ("p.jpg", big, "image/jpeg")}, data={"seq": "0"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "request_too_large"

    async def chunked_multipart():
        yield b'--xx\r\nContent-Disposition: form-data; name="image"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'
        for _ in range(limit // 65536 + 2):
            yield b"\x00" * 65536
        yield b"\r\n--xx--\r\n"

    r = await anon.post(
        "/api/books/x/pages", content=chunked_multipart(), headers={"content-type": "multipart/form-data; boundary=xx"}
    )
    assert "content-length" not in r.request.headers
    assert r.status_code == 413


async def test_migration_from_v1_adds_claim_token(tmp_path):
    import aiosqlite

    from app.db import MIGRATIONS, Database

    path = tmp_path / "old.db"
    async with aiosqlite.connect(path) as conn:
        await conn.executescript(f"BEGIN;{MIGRATIONS[0]}PRAGMA user_version=1;COMMIT;")
    db = Database(path)
    await db.connect()
    try:
        cols = [r["name"] for r in await db.fetchall("PRAGMA table_info(chunks)")]
        assert "claim_token" in cols
        assert (await db.fetchone("PRAGMA user_version"))[0] == len(MIGRATIONS)
    finally:
        await db.close()


async def test_malformed_json_is_uniform_400(alice):
    r = await alice.post("/api/books", content=b'{"title": "T\xe9t"}', headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"
