from datetime import timedelta

import pytest

from app.auth.session_service import COOKIE_NAME, hash_token
from app.cli import reset_password
from app.db import now_iso
from tests.conftest import INVITE, ctx_of, make_client


async def _register(client, **overrides):
    body = {"username": "carol", "display_name": "Carol", "password": "secret123", "invite_code": INVITE, **overrides}
    return await client.post("/api/auth/register", json=body)


async def test_register_sets_httponly_cookie_and_me_works(anon):
    r = await _register(anon)
    assert r.status_code == 201
    set_cookie = r.headers["set-cookie"].lower()
    assert COOKIE_NAME in set_cookie and "httponly" in set_cookie and "secure" in set_cookie and "samesite=lax" in set_cookie
    me = await anon.get("/api/me")
    assert me.status_code == 200
    assert me.json()["username"] == "carol"


@pytest.mark.parametrize("invite", ["", "sai-ma", INVITE + "x"])
async def test_register_rejects_bad_invite(anon, invite):
    r = await _register(anon, invite_code=invite)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "invite_invalid"


async def test_register_disabled_when_invite_code_unset(app, anon):
    ctx_of(app).settings.invite_code = ""
    r = await _register(anon, invite_code="")
    assert r.status_code == 403


@pytest.mark.parametrize(
    "overrides,field",
    [
        ({"username": "ab"}, "username"),
        ({"username": "có dấu"}, "username"),
        ({"display_name": "   "}, "display_name"),
        ({"display_name": "x" * 41}, "display_name"),
        ({"password": "12345"}, "password"),
    ],
)
async def test_register_validates_fields(anon, overrides, field):
    r = await _register(anon, **overrides)
    assert r.status_code == 400
    assert r.json()["error"]["field"] == field


async def test_register_missing_field_is_400(anon):
    r = await anon.post("/api/auth/register", json={"username": "x"})
    assert r.status_code == 400


async def test_username_is_case_insensitive_and_stored_lowercase(app, anon):
    assert (await _register(anon, username="Carol.Le")).status_code == 201
    assert (await anon.get("/api/me")).json()["username"] == "carol.le"
    async with make_client(app) as other:
        r = await other.post("/api/auth/login", json={"username": "CAROL.LE", "password": "secret123"})
        assert r.status_code == 200


async def test_login_success_and_generic_failure(app, alice):
    async with make_client(app) as c:
        ok = await c.post("/api/auth/login", json={"username": "ALICE", "password": "secret123"})
        assert ok.status_code == 200
        wrong_pw = await c.post("/api/auth/login", json={"username": "alice", "password": "nope-nope"})
        unknown = await c.post("/api/auth/login", json={"username": "nobody", "password": "secret123"})
        assert wrong_pw.status_code == unknown.status_code == 401
        assert wrong_pw.json() == unknown.json()


async def test_logout_invalidates_session(app, alice):
    token = alice.cookies.get(COOKIE_NAME)
    assert (await alice.post("/api/auth/logout")).status_code == 204
    async with make_client(app) as replay:
        replay.cookies.set(COOKIE_NAME, token, domain="test")
        assert (await replay.get("/api/me")).status_code == 401


async def test_expired_session_is_rejected(app, alice):
    token = alice.cookies.get(COOKIE_NAME)
    await ctx_of(app).db.execute(
        "UPDATE sessions SET expires_at=? WHERE token_hash=?", (now_iso(timedelta(seconds=-1)), hash_token(token))
    )
    assert (await alice.get("/api/me")).status_code == 401


async def test_session_sliding_renewal(app, alice):
    token_hash = hash_token(alice.cookies.get(COOKIE_NAME))
    old = now_iso(timedelta(days=-3))
    await ctx_of(app).db.execute("UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?", (old, now_iso(timedelta(days=10)), token_hash))
    assert (await alice.get("/api/me")).status_code == 200
    row = await ctx_of(app).db.fetchone("SELECT last_seen_at, expires_at FROM sessions WHERE token_hash=?", (token_hash,))
    assert row["last_seen_at"] > old
    assert row["expires_at"] > now_iso(timedelta(days=179))


async def test_session_token_not_stored_in_plaintext(app, alice):
    token = alice.cookies.get(COOKIE_NAME)
    rows = await ctx_of(app).db.fetchall("SELECT token_hash FROM sessions")
    assert all(r["token_hash"] != token for r in rows)
    account = await ctx_of(app).db.fetchone("SELECT password_hash FROM accounts WHERE username='alice'")
    assert account["password_hash"].startswith("$argon2")


async def test_rate_limit_returns_429(app, anon):
    ctx_of(app).auth_limiter.max_hits = 3
    codes = [(await anon.post("/api/auth/login", json={"username": "x", "password": "yyyyyy"})).status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/me"),
        ("get", "/api/me/continue"),
        ("get", "/api/books"),
        ("post", "/api/books"),
        ("get", "/api/books/x"),
        ("patch", "/api/books/x"),
        ("delete", "/api/books/x"),
        ("post", "/api/books/x/pages"),
        ("get", "/api/books/x/chunks"),
        ("get", "/api/books/x/progress"),
        ("put", "/api/books/x/progress"),
        ("patch", "/api/chunks/x"),
        ("post", "/api/chunks/x/retry"),
        ("get", "/api/chunks/x/audio"),
        ("post", "/api/pages/x/retry"),
        ("get", "/api/voices"),
        ("get", "/api/usage"),
        ("get", "/api/profiles"),
        ("post", "/api/profiles"),
        ("post", "/api/profiles/x/select"),
        ("patch", "/api/profiles/x"),
        ("delete", "/api/profiles/x"),
        ("post", "/api/me/password"),
        ("put", "/api/me/shelf/x"),
    ],
)
async def test_protected_routes_require_session(anon, method, path):
    r = await anon.request(method.upper(), path)
    assert r.status_code == 401, (path, r.status_code)


async def test_cli_reset_password_changes_password_and_revokes_sessions(app, alice, bob, monkeypatch):
    monkeypatch.setattr("app.cli.get_settings", lambda: ctx_of(app).settings)
    revoked = await reset_password("alice", "newpass456")
    # Every device of the family is signed out, whatever profile it was on.
    assert revoked >= 2
    assert (await alice.get("/api/me")).status_code == 401
    assert (await bob.get("/api/me")).status_code == 401
    async with make_client(app) as c:
        assert (await c.post("/api/auth/login", json={"username": "alice", "password": "secret123"})).status_code == 401
        assert (await c.post("/api/auth/login", json={"username": "alice", "password": "newpass456"})).status_code == 200


async def test_cli_reset_password_unknown_user(app, monkeypatch):
    monkeypatch.setattr("app.cli.get_settings", lambda: ctx_of(app).settings)
    with pytest.raises(LookupError):
        await reset_password("ghost", "whatever1")


def test_cli_unknown_user_message_points_to_the_family_login(app, monkeypatch, capsys):
    from app import cli

    async def missing(username, password):
        raise LookupError(username)

    monkeypatch.setattr(cli, "_prompt_password", lambda: "whatever1")
    monkeypatch.setattr(cli, "reset_password", missing)
    with pytest.raises(SystemExit) as exc:
        cli.main(["reset-password", "me"])
    assert "tài khoản gia đình" in str(exc.value)

