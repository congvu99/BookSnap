import aiosqlite

import asyncio

from app.api.bookmarks_routes import MAX_CHUNK_SEQ
from app.db import MIGRATIONS, Database, now_iso
from app.repositories.row_mapping import new_id
from tests.conftest import ctx_of


async def make_book(client, title="Chuyện làng ven sông") -> str:
    r = await client.post("/api/books", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def insert_chunk(app, book_id: str, seq: int, text: str) -> None:
    await ctx_of(app).db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, status, updated_at) VALUES (?,?,?,?,'pending',?)",
        (new_id(), book_id, seq, text, now_iso()),
    )


async def test_put_is_idempotent_and_keeps_created_at(alice, app):
    book_id = await make_book(alice)
    await insert_chunk(app, book_id, 3, "Chiều xuống, tôi ngồi trên bậc thềm.")
    first = await alice.put(f"/api/books/{book_id}/bookmarks/3")
    again = await alice.put(f"/api/books/{book_id}/bookmarks/3")
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json() and first.json()["chunk_seq"] == 3
    assert (await alice.get(f"/api/books/{book_id}/bookmarks")).json() == [3]
    listed = (await alice.get("/api/bookmarks")).json()
    assert listed == [
        {"book_id": book_id, "book_title": "Chuyện làng ven sông", "chunk_seq": 3,
         "excerpt": "Chiều xuống, tôi ngồi trên bậc thềm.", "created_at": first.json()["created_at"]}
    ]


async def test_concurrent_put_and_delete_never_error(alice):
    book_id = await make_book(alice)
    url = f"/api/books/{book_id}/bookmarks/4"
    for _ in range(30):
        put, delete = await asyncio.gather(alice.put(url), alice.delete(url))
        assert (put.status_code, delete.status_code) == (200, 204)
        assert put.json()["chunk_seq"] == 4


async def test_delete_is_idempotent(alice):
    book_id = await make_book(alice)
    await alice.put(f"/api/books/{book_id}/bookmarks/1")
    assert (await alice.delete(f"/api/books/{book_id}/bookmarks/1")).status_code == 204
    assert (await alice.delete(f"/api/books/{book_id}/bookmarks/1")).status_code == 204
    assert (await alice.get(f"/api/books/{book_id}/bookmarks")).json() == []


async def test_bookmarks_are_private_per_user(alice, bob):
    book_id = await make_book(alice)
    await alice.put(f"/api/books/{book_id}/bookmarks/2")
    assert (await bob.get("/api/bookmarks")).json() == []
    assert (await bob.get(f"/api/books/{book_id}/bookmarks")).json() == []
    await bob.put(f"/api/books/{book_id}/bookmarks/5")
    assert (await alice.get(f"/api/books/{book_id}/bookmarks")).json() == [2]


async def test_excerpt_truncated_and_null_without_chunk(alice, app):
    book_id = await make_book(alice)
    await insert_chunk(app, book_id, 0, "ạ" * 200)
    await alice.put(f"/api/books/{book_id}/bookmarks/0")
    await alice.put(f"/api/books/{book_id}/bookmarks/9")
    by_seq = {b["chunk_seq"]: b for b in (await alice.get("/api/bookmarks")).json()}
    assert by_seq[0]["excerpt"] == "ạ" * 160
    assert by_seq[9]["excerpt"] is None


async def test_deleting_book_removes_its_bookmarks(alice):
    book_id = await make_book(alice)
    await alice.put(f"/api/books/{book_id}/bookmarks/0")
    assert (await alice.delete(f"/api/books/{book_id}")).status_code == 204
    assert (await alice.get("/api/bookmarks")).json() == []


async def test_errors_unknown_book_negative_seq_and_auth(anon, alice):
    assert (await alice.put("/api/books/khong-co/bookmarks/0")).status_code == 404
    assert (await alice.delete("/api/books/khong-co/bookmarks/0")).status_code == 404
    book_id = await make_book(alice)
    for bad in ("-1", str(MAX_CHUNK_SEQ + 1), str(2**64)):
        r = await alice.put(f"/api/books/{book_id}/bookmarks/{bad}")
        assert r.status_code == 400 and r.json()["error"]["field"] == "chunk_seq", bad
    assert (await anon.get("/api/bookmarks")).status_code == 401
    assert (await anon.put(f"/api/books/{book_id}/bookmarks/0")).status_code == 401


async def test_migration_from_v3_keeps_data(tmp_path):
    path = tmp_path / "v3.db"
    async with aiosqlite.connect(path) as conn:
        await conn.executescript(f"BEGIN;{MIGRATIONS[0]}{MIGRATIONS[1]}{MIGRATIONS[2]}PRAGMA user_version=3;COMMIT;")
        await conn.execute("INSERT INTO users VALUES ('u','lan','Lan','h','t')")
        await conn.execute("INSERT INTO books(id, title, created_by, tts_provider, tts_voice, created_at, updated_at) VALUES ('b','Sách cũ','u','gemini','Kore','t','t')")
        await conn.execute("INSERT INTO progress VALUES ('u','b',4,1200,'t')")
        await conn.commit()
    db = Database(path)
    await db.connect()
    try:
        assert (await db.fetchone("PRAGMA user_version"))[0] == len(MIGRATIONS)
        assert (await db.fetchone("SELECT chunk_seq FROM progress WHERE user_id='u'"))["chunk_seq"] == 4
        assert (await db.fetchone("SELECT count(*) FROM bookmarks"))[0] == 0
    finally:
        await db.close()
