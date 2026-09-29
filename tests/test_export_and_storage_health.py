import io
import json
import zipfile
from pathlib import Path

from app.api.export_routes import ascii_slug
from app.storage_health import data_dir_durability_error
from tests.test_books_api import create_book, insert_done_chunk


async def test_export_zip_contains_audio_and_text(alice, bob, app):
    book = await create_book(alice, title="Truyện Kiều")
    c0 = await insert_done_chunk(app, book["id"], 0, audio_bytes=b"ID3" + b"a" * 700_000)
    c1 = await insert_done_chunk(app, book["id"], 1, audio_bytes=b"ID3" + b"b" * 10)
    r = await bob.get(f"/api/books/{book['id']}/export")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert "filename*=UTF-8''booksnap-Truy%E1%BB%87n%20Ki%E1%BB%81u.zip" in r.headers["content-disposition"]
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    assert zf.testzip() is None
    assert zf.read("audio/00001.mp3") == c0["bytes"]
    assert zf.read("audio/00002.mp3") == c1["bytes"]
    manifest = json.loads(zf.read("text.json"))
    assert manifest["title"] == "Truyện Kiều" and manifest["created_by_name"] == "Alice Nguyễn"
    assert [c["audio"] for c in manifest["chunks"]] == ["audio/00001.mp3", "audio/00002.mp3"]


async def test_export_skips_chunks_without_audio(alice, app):
    book = await create_book(alice)
    chunk = await insert_done_chunk(app, book["id"], 0)
    Path(chunk["path"]).unlink()
    r = await alice.get(f"/api/books/{book['id']}/export")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    assert zf.namelist() == ["text.json"]
    assert json.loads(zf.read("text.json"))["chunks"][0]["audio"] is None


async def test_export_requires_auth_and_book(anon, alice):
    assert (await anon.get("/api/books/x/export")).status_code == 401
    assert (await alice.get("/api/books/x/export")).status_code == 404


def test_ascii_slug():
    assert ascii_slug("Đất rừng phương Nam") == "dat-rung-phuong-nam"
    assert ascii_slug("!!!") == "book"


def test_durability_check(tmp_path):
    assert data_dir_durability_error(tmp_path, {}) is None
    assert data_dir_durability_error(tmp_path, {"RAILWAY_ENVIRONMENT_NAME": "production"}) == "no Railway volume attached"
    env = {"RAILWAY_ENVIRONMENT_NAME": "production", "RAILWAY_VOLUME_MOUNT_PATH": str(tmp_path / "vol")}
    assert "not inside" in data_dir_durability_error(tmp_path / "data", env)
    assert data_dir_durability_error(tmp_path / "vol", env) is None


async def test_health_fails_on_railway_without_volume(anon, monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    r = await anon.get("/health")
    assert r.status_code == 503 and "volume" in r.json()["data_dir"]
