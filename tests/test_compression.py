"""Text responses are gzip-encoded; audio and Range requests are streamed untouched."""

from fastapi.responses import JSONResponse, Response
from starlette.routing import Route

from tests.conftest import make_client

GZ = {"Accept-Encoding": "gzip"}
BIG = "x" * 5000


def _add_routes(app) -> None:
    async def big_json(request):
        return JSONResponse({"data": BIG})

    async def big_audio(request):
        return Response(b"\x00" * 5000, media_type="audio/mpeg")

    # Inserted first so they win over the static mount at "/".
    app.router.routes[0:0] = [
        Route("/api/_probe/json", big_json),
        Route("/api/chunks/abc/audio", big_audio),
    ]


async def test_json_api_is_gzipped(app):
    _add_routes(app)
    async with make_client(app) as c:
        r = await c.get("/api/_probe/json", headers=GZ)
    assert r.headers["content-encoding"] == "gzip"
    assert r.json() == {"data": BIG}


async def test_static_js_is_gzipped(app):
    async with make_client(app) as c:
        r = await c.get("/js/app.js", headers=GZ)
    assert r.status_code == 200
    assert r.headers["content-encoding"] == "gzip"


async def test_no_gzip_without_accept_encoding(app):
    async with make_client(app) as c:
        r = await c.get("/js/app.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in r.headers


async def test_chunk_audio_is_not_gzipped(app):
    _add_routes(app)
    async with make_client(app) as c:
        r = await c.get("/api/chunks/abc/audio", headers=GZ)
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert r.headers["content-length"] == "5000"


async def test_ambient_audio_is_not_gzipped_and_supports_range(app):
    async with make_client(app) as c:
        full = await c.get("/audio/ambient/piano.mp3", headers=GZ)
        part = await c.get("/audio/ambient/piano.mp3", headers={**GZ, "Range": "bytes=0-99"})
    assert full.status_code == 200 and "content-encoding" not in full.headers
    assert part.status_code == 206 and "content-encoding" not in part.headers
    assert part.headers["content-range"].startswith("bytes 0-99/")


async def test_range_request_on_text_is_not_gzipped(app):
    async with make_client(app) as c:
        r = await c.get("/js/app.js", headers={**GZ, "Range": "bytes=0-9"})
    assert r.status_code == 206
    assert "content-encoding" not in r.headers


async def test_health_still_works(app):
    async with make_client(app) as c:
        r = await c.get("/health", headers=GZ)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
