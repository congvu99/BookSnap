import aiosqlite
import pytest

from app.db import MIGRATIONS, Database
from app.repositories.topic_repository import topic_key


async def test_create_book_with_new_topic_and_reuse_by_normalized_name(alice, bob):
    first = (await alice.post("/api/books", json={"title": "Truyện Kiều", "topic": "  Văn   học "})).json()
    assert first["topic"]["name"] == "Văn học"
    second = (await bob.post("/api/books", json={"title": "Số đỏ", "topic": "VĂN HỌC"})).json()
    assert second["topic"]["id"] == first["topic"]["id"]
    assert (await alice.get("/api/topics")).json() == [{"id": first["topic"]["id"], "name": "Văn học", "book_count": 2}]


async def test_book_without_topic(alice):
    book = (await alice.post("/api/books", json={"title": "Không phân loại"})).json()
    assert book["topic"] is None
    assert (await alice.get("/api/topics")).json() == []
    listed = (await alice.get("/api/books")).json()
    assert listed[0]["topic"] is None


async def test_patch_topic_owner_only_and_clear(alice, bob):
    book = (await alice.post("/api/books", json={"title": "Sử ký", "topic": "Lịch sử"})).json()
    url = f"/api/books/{book['id']}"
    assert (await bob.patch(url, json={"topic": "Khác"})).status_code == 403
    moved = (await alice.patch(url, json={"topic": "Khảo cứu"})).json()
    assert moved["topic"]["name"] == "Khảo cứu"
    assert [t["name"] for t in (await alice.get("/api/topics")).json()] == ["Khảo cứu"], "empty topic hidden"
    untouched = (await alice.patch(url, json={"title": "Sử ký mới"})).json()
    assert untouched["topic"]["name"] == "Khảo cứu", "omitted topic leaves it unchanged"
    cleared = (await alice.patch(url, json={"topic": None})).json()
    assert cleared["topic"] is None
    assert (await alice.patch(url, json={"topic": "Khảo cứu"})).json()["topic"]["id"] == moved["topic"]["id"]
    assert (await alice.patch(url, json={"topic": "   "})).json()["topic"] is None


@pytest.mark.parametrize("topic", ["x" * 41])
async def test_topic_too_long_rejected(alice, topic):
    r = await alice.post("/api/books", json={"title": "Sách", "topic": topic})
    assert r.status_code == 400 and r.json()["error"]["field"] == "topic"


async def test_topics_sorted_and_require_auth(anon, alice):
    for title, topic in (("a", "Thiếu nhi"), ("b", "Âm nhạc"), ("c", "Lịch sử")):
        await alice.post("/api/books", json={"title": title, "topic": topic})
    names = [t["name"] for t in (await alice.get("/api/topics")).json()]
    assert names == ["Âm nhạc", "Lịch sử", "Thiếu nhi"]
    assert (await anon.get("/api/topics")).status_code == 401


async def test_delete_last_book_hides_topic(alice):
    book = (await alice.post("/api/books", json={"title": "Một mình", "topic": "Hiếm"})).json()
    assert (await alice.delete(f"/api/books/{book['id']}")).status_code == 204
    assert (await alice.get("/api/topics")).json() == []


def test_topic_key_normalizes_case_space_and_unicode_form():
    decomposed = "Văn học"  # combining marks
    assert topic_key("  VĂN   HỌC ") == topic_key("văn học")
    assert topic_key(decomposed) == topic_key("Văn học")


async def test_migration_from_v2_keeps_books(tmp_path):
    path = tmp_path / "v2.db"
    async with aiosqlite.connect(path) as conn:
        await conn.executescript(f"BEGIN;{MIGRATIONS[0]}{MIGRATIONS[1]}PRAGMA user_version=2;COMMIT;")
        await conn.execute("INSERT INTO users VALUES ('u','lan','Lan','h','t')")
        await conn.execute("INSERT INTO books VALUES ('b','Sách cũ','u','gemini','Kore','t','t')")
        await conn.commit()
    db = Database(path)
    await db.connect()
    try:
        row = await db.fetchone("SELECT title, topic_id FROM books WHERE id='b'")
        assert (row["title"], row["topic_id"]) == ("Sách cũ", None)
        assert (await db.fetchone("PRAGMA user_version"))[0] == len(MIGRATIONS)
    finally:
        await db.close()


async def test_invalid_topic_in_patch_changes_nothing(alice):
    book = (await alice.post("/api/books", json={"title": "Gốc", "topic": "Cũ"})).json()
    r = await alice.patch(f"/api/books/{book['id']}", json={"title": "Mới", "topic": "x" * 41})
    assert r.status_code == 400 and r.json()["error"]["field"] == "topic"
    after = (await alice.get(f"/api/books/{book['id']}")).json()
    assert (after["title"], after["topic"]["name"]) == ("Gốc", "Cũ")


async def test_topic_boundaries_on_create(alice):
    ok = await alice.post("/api/books", json={"title": "a", "topic": "x" * 40})
    assert ok.status_code == 201 and ok.json()["topic"]["name"] == "x" * 40
    blank = await alice.post("/api/books", json={"title": "b", "topic": ""})
    assert blank.status_code == 201 and blank.json()["topic"] is None


def test_vietnamese_sort_key_orders_d_after_d_plain():
    from app.repositories.topic_repository import vietnamese_sort_key

    assert sorted(["Đạo đức", "Du ký", "Âm nhạc", "An nam"], key=vietnamese_sort_key) == ["An nam", "Âm nhạc", "Du ký", "Đạo đức"]
