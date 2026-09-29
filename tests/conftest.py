from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.main import create_app

INVITE = "moi-vao-nha"
TINY_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
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
    client = make_client(app)
    r = await client.post(
        "/api/auth/register",
        json={"username": username, "display_name": display_name or username.title(), "password": password, "invite_code": INVITE},
    )
    assert r.status_code == 201, r.text
    return client


@pytest.fixture
async def alice(app) -> AsyncIterator[httpx.AsyncClient]:
    c = await register(app, "alice", "Alice Nguyễn")
    yield c
    await c.aclose()


@pytest.fixture
async def bob(app) -> AsyncIterator[httpx.AsyncClient]:
    c = await register(app, "bob", "Bob Trần")
    yield c
    await c.aclose()


def ctx_of(app):
    return app.state.ctx
