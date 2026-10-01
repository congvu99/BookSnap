import asyncio

import pytest

from app.auth.session_service import COOKIE_NAME
from tests.conftest import INVITE, add_profile, ctx_of, login_and_select, make_client, profile_id_of


def _register_body(username: str = "carol") -> dict:
    return {"username": username, "display_name": username.title(), "password": "secret123", "invite_code": INVITE}


async def _login(client, username: str = "alice"):
    return await client.post("/api/auth/login", json={"username": username, "password": "secret123"})


async def test_registration_closes_once_the_family_account_exists(app, anon):
    assert (await anon.get("/api/auth/status")).json() == {"registration_open": True}
    assert (await anon.post("/api/auth/register", json=_register_body("alice"))).status_code == 201
    assert (await anon.get("/api/auth/status")).json() == {"registration_open": False}
    async with make_client(app) as other:
        r = await other.post("/api/auth/register", json=_register_body("bob"))
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "registration_closed"


async def test_concurrent_registrations_create_exactly_one_account(app):
    clients = [make_client(app) for _ in range(2)]
    results = await asyncio.gather(*(c.post("/api/auth/register", json=_register_body(f"user{i}")) for i, c in enumerate(clients)))
    assert sorted(r.status_code for r in results) == [201, 403]
    assert (await ctx_of(app).db.fetchone("SELECT count(*) FROM accounts"))[0] == 1
    for c in clients:
        await c.aclose()


async def test_failed_registration_leaves_no_half_created_account(app, anon, monkeypatch):
    async def broken_create(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(ctx_of(app).users, "create", broken_create)
    with pytest.raises(RuntimeError):
        await anon.post("/api/auth/register", json=_register_body())
    assert (await ctx_of(app).db.fetchone("SELECT count(*) FROM accounts"))[0] == 0
    assert (await anon.get("/api/auth/status")).json() == {"registration_open": True}


async def test_login_auto_selects_the_only_profile_and_stays_backward_compatible(app, alice):
    async with make_client(app) as device:
        r = await _login(device)
        assert r.status_code == 200
        body = r.json()
        # Old cached clients read the profile straight from the top level.
        assert body["display_name"] == "Alice Nguyễn" and body["id"] and body["username"] == "alice"
        assert body["profile_required"] is False
        assert body["account"]["username"] == "alice"
        assert (await device.get("/api/me")).status_code == 200


async def test_login_with_several_profiles_requires_picking_one(app, alice, bob):
    async with make_client(app) as device:
        body = (await _login(device)).json()
        assert body["profile_required"] is True
        assert body["id"] is None and body["display_name"] is None
        r = await device.get("/api/me")
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "profile_required"

        profiles = (await device.get("/api/profiles")).json()
        assert [p["display_name"] for p in profiles] == ["Alice Nguyễn", "Bob Trần"]
        assert {p["avatar"] for p in profiles} <= {f"c{i}" for i in range(1, 9)}

        bob_id = await profile_id_of(app, "Bob Trần")
        selected = await device.post(f"/api/profiles/{bob_id}/select")
        assert selected.status_code == 200
        assert selected.json()["display_name"] == "Bob Trần"
        assert (await device.get("/api/me")).json()["id"] == bob_id


async def test_select_rejects_profiles_outside_the_family(app, alice):
    await ctx_of(app).db.execute("INSERT INTO accounts VALUES ('other-acc','other','x','t')")
    await ctx_of(app).db.execute("INSERT INTO users VALUES ('stranger','other-acc','Người lạ','c1','t')")
    for profile_id in ("stranger", "does-not-exist"):
        assert (await alice.post(f"/api/profiles/{profile_id}/select")).status_code == 404


async def test_create_profile_validates_and_caps_at_eight(app, alice):
    assert (await alice.post("/api/profiles", json={"display_name": "  "})).status_code == 400
    bad_avatar = await alice.post("/api/profiles", json={"display_name": "Con", "avatar": "c9"})
    assert bad_avatar.status_code == 400 and bad_avatar.json()["error"]["code"] == "avatar_invalid"
    for i in range(7):
        r = await alice.post("/api/profiles", json={"display_name": f"Hồ sơ {i}", "avatar": "c3"})
        assert r.status_code == 201, r.text
        assert r.json()["avatar"] == "c3"
    ninth = await alice.post("/api/profiles", json={"display_name": "Thứ chín"})
    assert ninth.status_code == 409 and ninth.json()["error"]["code"] == "profile_limit"


async def test_profiles_keep_separate_progress_under_one_login(app, alice, bob):
    book = (await alice.post("/api/books", json={"title": "Dế Mèn"})).json()
    assert (await alice.put(f"/api/books/{book['id']}/progress", json={"chunk_seq": 5, "offset_ms": 1000})).status_code == 200
    assert (await bob.put(f"/api/books/{book['id']}/progress", json={"chunk_seq": 1, "offset_ms": 0})).status_code == 200
    assert (await alice.get(f"/api/books/{book['id']}/progress")).json()["chunk_seq"] == 5
    assert (await bob.get(f"/api/books/{book['id']}/progress")).json()["chunk_seq"] == 1


async def test_switching_profile_on_one_device_changes_who_writes(app, alice, bob):
    book = (await alice.post("/api/books", json={"title": "Sách"})).json()
    alice_id = await profile_id_of(app, "Alice Nguyễn")
    bob_id = await profile_id_of(app, "Bob Trần")
    async with make_client(app) as tablet:
        await _login(tablet)
        await tablet.post(f"/api/profiles/{alice_id}/select")
        await tablet.put(f"/api/books/{book['id']}/progress", json={"chunk_seq": 5, "offset_ms": 0})
        await tablet.post(f"/api/profiles/{bob_id}/select")
        assert (await tablet.get(f"/api/books/{book['id']}/progress")).json()["chunk_seq"] != 5
        await tablet.post(f"/api/profiles/{alice_id}/select")
        assert (await tablet.get(f"/api/books/{book['id']}/progress")).json()["chunk_seq"] == 5


async def test_profile_header_mismatch_is_rejected(app, alice, bob):
    """Two tabs share the cookie: a tab still on Alice must not write into the profile another tab picked."""
    alice_id = await profile_id_of(app, "Alice Nguyễn")
    bob_id = await profile_id_of(app, "Bob Trần")
    tab1 = await login_and_select(app, alice_id)
    async with make_client(app) as tab2:
        shared_cookie = {"Cookie": f"{COOKIE_NAME}={tab1.cookies.get(COOKIE_NAME)}"}
        assert (await tab2.post(f"/api/profiles/{bob_id}/select", headers=shared_cookie)).status_code == 200
        r = await tab1.get("/api/me", headers={"X-Profile-Id": alice_id})
        assert r.status_code == 409 and r.json()["error"]["code"] == "profile_mismatch"
        assert (await tab1.get("/api/me", headers={"X-Profile-Id": bob_id})).status_code == 200
        # No header (older clients) keeps working.
        assert (await tab1.get("/api/me")).status_code == 200
    await tab1.aclose()


@pytest.mark.parametrize(("method", "path"), [("get", "/api/voices"), ("get", "/api/usage"), ("get", "/api/profiles")])
async def test_family_wide_routes_work_before_picking_a_profile(app, alice, bob, method, path):
    async with make_client(app) as device:
        await _login(device)
        assert (await device.request(method.upper(), path)).status_code == 200


async def test_deleted_profile_request_gets_409_not_500(app, alice, bob):
    book = (await alice.post("/api/books", json={"title": "Sách"})).json()
    bob_id = await profile_id_of(app, "Bob Trần")
    # Simulate the profile disappearing between session resolution and the write.
    async def vanish_then_upsert(user_id, *args, **kwargs):
        await ctx_of(app).db.execute("DELETE FROM users WHERE id=?", (bob_id,))
        return await original(user_id, *args, **kwargs)

    original = ctx_of(app).progress.upsert
    ctx_of(app).progress.upsert = vanish_then_upsert
    r = await bob.put(f"/api/books/{book['id']}/progress", json={"chunk_seq": 1, "offset_ms": 0})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "profile_required"


async def test_any_profile_can_rename_and_recolour_family_profiles(app, alice, bob):
    bob_id = await profile_id_of(app, "Bob Trần")
    r = await alice.patch(f"/api/profiles/{bob_id}", json={"display_name": "  Bé Bin ", "avatar": "c5"})
    assert r.status_code == 200
    assert r.json() == {"id": bob_id, "display_name": "Bé Bin", "avatar": "c5"}
    assert (await alice.patch(f"/api/profiles/{bob_id}", json={"avatar": "c0"})).status_code == 400
    assert (await alice.patch(f"/api/profiles/{bob_id}", json={"display_name": " "})).status_code == 400
    assert (await alice.patch("/api/profiles/khong-co", json={"avatar": "c2"})).status_code == 404


async def test_deleting_a_profile_needs_the_family_password(app, alice, bob):
    bob_id = await profile_id_of(app, "Bob Trần")
    assert (await alice.request("DELETE", f"/api/profiles/{bob_id}", json={})).status_code == 400
    wrong = await alice.request("DELETE", f"/api/profiles/{bob_id}", json={"password": "sai-roi-1"})
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "password_invalid"
    assert (await alice.request("DELETE", f"/api/profiles/{bob_id}", json={"password": "secret123"})).status_code == 204
    assert [p["display_name"] for p in (await alice.get("/api/profiles")).json()] == ["Alice Nguyễn"]


async def test_deleted_profile_hands_its_books_to_the_oldest_remaining_profile(app, alice, bob):
    carol, _ = await add_profile(app, alice, "Carol")
    bob_book = (await bob.post("/api/books", json={"title": "Sách của Bob", "topic": "Truyện"})).json()
    await bob.put(f"/api/books/{bob_book['id']}/progress", json={"chunk_seq": 2, "offset_ms": 0})
    await bob.put(f"/api/books/{bob_book['id']}/bookmarks/0")
    await bob.put(f"/api/me/shelf/{bob_book['id']}")
    bob_id = await profile_id_of(app, "Bob Trần")
    alice_id = await profile_id_of(app, "Alice Nguyễn")

    # Carol deletes Bob: the books go to Alice (oldest), not to the one who pressed delete.
    r = await carol.request("DELETE", f"/api/profiles/{bob_id}", json={"password": "secret123"})
    assert r.status_code == 204
    book = (await alice.get(f"/api/books/{bob_book['id']}")).json()
    assert book["created_by"] == alice_id and book["created_by_name"] == "Alice Nguyễn" and book["can_manage"] is True
    db = ctx_of(app).db
    assert (await db.fetchone("SELECT created_by FROM topics WHERE name='Truyện'"))[0] == alice_id
    for table in ("progress", "bookmarks", "shelf_items"):
        assert (await db.fetchone(f"SELECT count(*) FROM {table} WHERE user_id=?", (bob_id,)))[0] == 0
    # Bob's device is sent back to the picker.
    r = await bob.get("/api/me")
    assert r.status_code == 409 and r.json()["error"]["code"] == "profile_required"
    await carol.aclose()


async def test_cannot_delete_the_profile_in_use_or_outside_the_family(app, alice, bob):
    alice_id = await profile_id_of(app, "Alice Nguyễn")
    r = await alice.request("DELETE", f"/api/profiles/{alice_id}", json={"password": "secret123"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "profile_active"
    await ctx_of(app).db.execute("INSERT INTO accounts VALUES ('other-acc','other','x','t')")
    await ctx_of(app).db.execute("INSERT INTO users VALUES ('stranger','other-acc','Người lạ','c1','t')")
    assert (await alice.request("DELETE", "/api/profiles/stranger", json={"password": "secret123"})).status_code == 404


async def test_stale_request_from_a_deleted_profile_gets_409(app, alice, bob):
    book = (await alice.post("/api/books", json={"title": "Sách"})).json()
    bob_id = await profile_id_of(app, "Bob Trần")
    assert (await alice.request("DELETE", f"/api/profiles/{bob_id}", json={"password": "secret123"})).status_code == 204
    r = await bob.put(f"/api/books/{book['id']}/progress", json={"chunk_seq": 1, "offset_ms": 0})
    assert r.status_code == 409
