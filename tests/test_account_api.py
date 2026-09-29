from tests.conftest import make_client


async def test_profile_returns_identity_and_stats(alice):
    book = (await alice.post("/api/books", json={"title": "Dế Mèn"})).json()
    await alice.put(f"/api/books/{book['id']}/bookmarks/0")
    r = await alice.get("/api/me/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "alice" and body["display_name"] == "Alice Nguyễn"
    assert body["created_at"]
    assert body["stats"] == {"books_created": 1, "pages_captured": 0, "books_listening": 0, "bookmarks": 1}
    assert "password_hash" not in body


async def test_profile_requires_login(anon):
    assert (await anon.get("/api/me/profile")).status_code == 401
    assert (await anon.patch("/api/me", json={"display_name": "X"})).status_code == 401


async def test_update_display_name_trims_and_shows_on_books(alice):
    book = (await alice.post("/api/books", json={"title": "Sách"})).json()
    r = await alice.patch("/api/me", json={"display_name": "  Alice Lê  "})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Alice Lê"
    assert (await alice.get("/api/me")).json()["display_name"] == "Alice Lê"
    assert (await alice.get(f"/api/books/{book['id']}")).json()["created_by_name"] == "Alice Lê"


async def test_update_display_name_validates(alice):
    for bad in ("   ", "x" * 41):
        r = await alice.patch("/api/me", json={"display_name": bad})
        assert r.status_code == 400
        assert r.json()["error"]["field"] == "display_name"


async def test_change_password_keeps_current_session_and_revokes_others(app, alice):
    other_device = make_client(app)
    assert (await other_device.post("/api/auth/login", json={"username": "alice", "password": "secret123"})).status_code == 200
    r = await alice.post("/api/me/password", json={"current_password": "secret123", "new_password": "moi-hon-123"})
    assert r.status_code == 200
    assert r.json() == {"other_sessions_revoked": 1}
    assert (await alice.get("/api/me")).status_code == 200
    assert (await other_device.get("/api/me")).status_code == 401
    async with make_client(app) as fresh:
        assert (await fresh.post("/api/auth/login", json={"username": "alice", "password": "secret123"})).status_code == 401
        assert (await fresh.post("/api/auth/login", json={"username": "alice", "password": "moi-hon-123"})).status_code == 200
    await other_device.aclose()


async def test_change_password_rejects_wrong_current_short_or_unchanged(alice):
    cases = [
        ({"current_password": "sai-roi-1", "new_password": "moi-hon-123"}, "current_password"),
        ({"current_password": "secret123", "new_password": "12345"}, "new_password"),
        ({"current_password": "secret123", "new_password": "secret123"}, "new_password"),
    ]
    for body, field in cases:
        r = await alice.post("/api/me/password", json=body)
        assert r.status_code == 400
        assert r.json()["error"]["field"] == field
    assert (await alice.get("/api/me")).status_code == 200


async def test_change_password_is_rate_limited(app, alice):
    app.state.ctx.auth_limiter.max_hits = 2
    body = {"current_password": "sai-roi-1", "new_password": "moi-hon-123"}
    statuses = [(await alice.post("/api/me/password", json=body)).status_code for _ in range(3)]
    assert statuses == [400, 400, 429]
