async def _book(client, title: str = "Dế Mèn") -> dict:
    r = await client.post("/api/books", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()


async def _on_shelf(client, book_id: str) -> bool:
    return (await client.get(f"/api/books/{book_id}")).json()["on_shelf"]


async def test_shelf_is_per_profile_while_the_library_stays_shared(alice, bob):
    book = await _book(alice)
    assert (await alice.put(f"/api/me/shelf/{book['id']}")).status_code == 204
    assert await _on_shelf(alice, book["id"]) is True
    assert await _on_shelf(bob, book["id"]) is False
    alice_list = {b["id"]: b["on_shelf"] for b in (await alice.get("/api/books")).json()}
    bob_list = {b["id"]: b["on_shelf"] for b in (await bob.get("/api/books")).json()}
    assert alice_list == {book["id"]: True}
    assert bob_list == {book["id"]: False}


async def test_shelf_flag_also_reaches_continue_listening(alice):
    book = await _book(alice)
    await alice.put(f"/api/books/{book['id']}/progress", json={"chunk_seq": 0, "offset_ms": 0})
    await alice.put(f"/api/me/shelf/{book['id']}")
    [continuing] = (await alice.get("/api/me/continue")).json()
    assert continuing["on_shelf"] is True


async def test_shelf_add_and_remove_are_idempotent(alice):
    book = await _book(alice)
    for _ in range(2):
        assert (await alice.put(f"/api/me/shelf/{book['id']}")).status_code == 204
    assert await _on_shelf(alice, book["id"]) is True
    for _ in range(2):
        assert (await alice.delete(f"/api/me/shelf/{book['id']}")).status_code == 204
    assert await _on_shelf(alice, book["id"]) is False


async def test_shelf_rejects_unknown_book_and_forgets_deleted_ones(app, alice):
    assert (await alice.put("/api/me/shelf/khong-co")).status_code == 404
    book = await _book(alice)
    await alice.put(f"/api/me/shelf/{book['id']}")
    assert (await alice.delete(f"/api/books/{book['id']}")).status_code == 204
    assert (await app.state.ctx.db.fetchone("SELECT count(*) FROM shelf_items"))[0] == 0


async def test_shelf_needs_a_profile(anon):
    assert (await anon.put("/api/me/shelf/x")).status_code == 401
