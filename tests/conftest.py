from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.main import create_app

INVITE = "moi-vao-nha"
TINY_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    # Tests run on code defaults, never on whatever the developer's shell exports.
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    return Settings(_env_file=None, data_dir=tmp_path / "data", invite_code=INVITE, auth_rate_limit_per_minute=1000, worker_enabled=False)


@pytest.fixture
async def app(settings: Settings):
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


def make_client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test")


@pytest.fixture
async def anon(app) -> AsyncIterator[httpx.AsyncClient]:
    async with make_client(app) as c:
        yield c


async def register(app, username: str, display_name: str | None = None, password: str = "secret123") -> httpx.AsyncClient:
    """Create the (single) family account; the client is signed in on its first profile."""
    client = make_client(app)
    r = await client.post(
        "/api/auth/register",
        json={"username": username, "display_name": display_name or username.title(), "password": password, "invite_code": INVITE},
    )
    assert r.status_code == 201, r.text
    return client


async def login_and_select(app, profile_id: str, username: str = "alice", password: str = "secret123") -> httpx.AsyncClient:
    """A fresh device: sign in to the family account, then pick a profile."""
    client = make_client(app)
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/profiles/{profile_id}/select")
    assert r.status_code == 200, r.text
    return client


async def add_profile(app, owner: httpx.AsyncClient, display_name: str) -> tuple[httpx.AsyncClient, str]:
    """Add a profile to the owner's family and return a separate device signed in on it."""
    r = await owner.post("/api/profiles", json={"display_name": display_name})
    assert r.status_code == 201, r.text
    profile_id = r.json()["id"]
    return await login_and_select(app, profile_id), profile_id


async def profile_id_of(app, display_name: str) -> str:
    row = await ctx_of(app).db.fetchone("SELECT id FROM users WHERE display_name=?", (display_name,))
    assert row is not None, display_name
    return row["id"]


@pytest.fixture
async def alice(app) -> AsyncIterator[httpx.AsyncClient]:
    c = await register(app, "alice", "Alice Nguyễn")
    yield c
    await c.aclose()


@pytest.fixture
async def bob(app, alice) -> AsyncIterator[httpx.AsyncClient]:
    """Second profile in Alice's family: a different user_id, same login."""
    c, _ = await add_profile(app, alice, "Bob Trần")
    yield c
    await c.aclose()


def ctx_of(app):
    return app.state.ctx
