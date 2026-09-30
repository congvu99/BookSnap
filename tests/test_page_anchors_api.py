from app.db import now_iso
from app.repositories.row_mapping import new_id
from tests.conftest import ctx_of
from tests.test_pipeline_end_to_end import FakeTts, make_worker, page_image, wait_all_done


async def make_book(client, title="Chuyện làng ven sông") -> str:
    r = await client.post("/api/books", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def insert_page(app, book_id: str, seq: int, status: str, text: str | None = None, chunked: bool = False, error: str | None = None) -> None:
    now = now_iso()
    await ctx_of(app).db.execute(
        "INSERT INTO pages(id, book_id, seq, status, text, chunked, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (new_id(), book_id, seq, status, text, int(chunked), error, now, now),
    )


async def insert_chunk(app, book_id: str, seq: int, text: str) -> None:
    await ctx_of(app).db.execute(
        "INSERT INTO chunks(id, book_id, seq, text, status, updated_at) VALUES (?,?,?,?,'pending',?)",
        (new_id(), book_id, seq, text, now_iso()),
    )


async def test_requires_login(anon):
    assert (await anon.get("/api/books/whatever/page-anchors")).status_code == 401


async def test_unknown_book_is_404(alice):
    assert (await alice.get("/api/books/nope/page-anchors")).status_code == 404


async def test_book_without_pages_returns_empty_list(alice):
    book_id = await make_book(alice)
    r = await alice.get(f"/api/books/{book_id}/page-anchors")
    assert r.status_code == 200 and r.json() == []


async def test_shape_and_order_follow_the_contract(alice, app):
    book_id = await make_book(alice)
    await insert_page(app, book_id, 2, "uploaded")
    await insert_page(app, book_id, 0, "ocr_done", "Chiều xuống.", chunked=True)
    await insert_page(app, book_id, 1, "discarded", chunked=True)
    await insert_chunk(app, book_id, 0, "Chiều xuống.")
    r = await alice.get(f"/api/books/{book_id}/page-anchors")
    assert r.status_code == 200
    assert r.json() == [
        {"page_seq": 0, "status": "ready", "chunk_seq": 0, "chunk_frac": 0.0, "excerpt": "Chiều xuống."},
        {"page_seq": 1, "status": "discarded", "chunk_seq": None, "chunk_frac": None, "excerpt": ""},
        {"page_seq": 2, "status": "pending", "chunk_seq": None, "chunk_frac": None, "excerpt": ""},
    ]


async def test_other_user_can_read_shared_library_book(alice, bob, app):
    book_id = await make_book(alice)
    await insert_page(app, book_id, 0, "ocr_done", "Một.", chunked=True)
    await insert_chunk(app, book_id, 0, "Một.")
    r = await bob.get(f"/api/books/{book_id}/page-anchors")
    assert r.status_code == 200 and r.json()[0]["status"] == "ready"


async def test_failed_page_does_not_leak_provider_error(alice, app):
    book_id = await make_book(alice)
    await insert_page(app, book_id, 0, "failed", error="Gemini 500: secret upstream detail")
    r = await alice.get(f"/api/books/{book_id}/page-anchors")
    assert r.json() == [{"page_seq": 0, "status": "failed", "chunk_seq": None, "chunk_frac": None, "excerpt": ""}]
    assert "secret" not in r.text


async def test_anchors_match_real_pipeline_output(alice, app):
    worker = make_worker(app, FakeTts("gemini"), FakeTts("azure"))
    ctx_of(app).worker = worker
    await worker.start()
    try:
        bid = await make_book(alice, "Dế Mèn")
        for seq in range(5):
            r = await alice.post(f"/api/books/{bid}/pages", files={"image": ("p.jpg", page_image(seq), "image/jpeg")}, data={"seq": str(seq)})
            assert r.status_code == 202
        chunks = await wait_all_done(alice, bid, 5)
        anchors = (await alice.get(f"/api/books/{bid}/page-anchors")).json()
    finally:
        await worker.stop()

    assert [a["status"] for a in anchors] == ["ready"] * 5
    by_seq = {c["seq"]: c["text"] for c in chunks}
    # (page, its first words, text that ends the page before it: page 4 repeats earlier sentences)
    for page_seq, needle, after in ((1, "sang trang sau", ""), (3, "Trang ba", ""), (4, "Mèn ta", "một câu ngắn.")):
        a = anchors[page_seq]
        text = by_seq[a["chunk_seq"]]
        start = text.index(after) + len(after) if after else 0
        assert a["chunk_frac"] == round(text.index(needle, start) / len(text), 4), (page_seq, a)
    assert anchors[0] == {**anchors[0], "chunk_seq": min(by_seq), "chunk_frac": 0.0}
