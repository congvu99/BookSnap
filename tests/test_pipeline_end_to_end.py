"""Full flow through the HTTP API with the real worker loops running (fake OCR/TTS, no network)."""

import asyncio
import io
import json
import zipfile

from app.pipeline.audio_encoding import pcm16_to_mp3
from app.pipeline.ocr_provider import PageText
from app.pipeline.tts_provider import SynthResult, TtsError
from app.pipeline.worker import Worker
from tests.conftest import TINY_JPEG, ctx_of

FAST = (0.01, 0.01, 0.01)
SENTENCE = "Mèn ta đi qua cánh đồng lúa chín vàng, nghe gió thổi rì rào bên tai. "


def page_image(seq: int) -> bytes:
    return TINY_JPEG[:-2] + bytes([seq]) * 8 + b"\xff\xd9"


PAGES = {
    0: PageText(paragraphs=["Chương một", SENTENCE * 10, "Đoạn này bị ngắt giữa chừng khi"], continues_on_next_page=True),
    1: PageText(paragraphs=["sang trang sau thì mới kết thúc câu.", SENTENCE * 20], continues_on_next_page=False),
    2: PageText(paragraphs=[SENTENCE * 25], continues_on_next_page=False),
    3: PageText(paragraphs=["Trang ba chỉ có một câu ngắn."], continues_on_next_page=False),
    4: PageText(paragraphs=[SENTENCE * 8, "Hết chương."], continues_on_next_page=False),
}


class FakeOcr:
    async def extract(self, image: bytes, mime: str) -> PageText:
        return PAGES[image[-3]]


class FakeTts:
    def __init__(self, name: str, quota_once_marker: str | None = None) -> None:
        self.name = name
        self.calls: list[tuple[str, str]] = []
        self.quota_once_marker = quota_once_marker
        self._mp3, self._ms = pcm16_to_mp3(b"\x00\x00" * 2400)

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        self.calls.append((text, voice))
        if self.quota_once_marker and self.quota_once_marker in text:
            self.quota_once_marker = None
            raise TtsError("429 quota", retryable=False, quota=True, retry_after=0.3)
        return SynthResult(mp3=self._mp3 + text.encode(), duration_ms=self._ms)


def make_worker(app, gemini: FakeTts, azure: FakeTts) -> Worker:
    return Worker(
        ctx_of(app),
        ocr_provider=FakeOcr(),
        tts_providers={"gemini": gemini, "azure": azure},
        poll_seconds=0.02,
        grace_seconds=0.2,
        ocr_backoff_seconds=FAST,
        tts_backoff_seconds=FAST,
    )


async def wait_all_done(client, book_id: str, expected_pages: int, timeout: float = 20.0) -> list[dict]:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        book = (await client.get(f"/api/books/{book_id}")).json()
        chunks = (await client.get(f"/api/books/{book_id}/chunks")).json()
        if book["pages"]["done"] == expected_pages and chunks and all(c["status"] == "done" for c in chunks):
            return chunks
        await asyncio.sleep(0.05)
    raise AssertionError(f"not done: {book['pages']} {[c['status'] for c in chunks]}")


def library_files(app, book_id: str) -> list[str]:
    d = ctx_of(app).settings.library_dir / book_id
    return sorted(p.name for p in d.iterdir()) if d.exists() else []


async def test_pipeline_end_to_end(alice, bob, app):
    gemini, azure = FakeTts("gemini", quota_once_marker="Trang ba"), FakeTts("azure")
    worker = make_worker(app, gemini, azure)
    ctx_of(app).worker = worker
    await worker.start()
    try:
        book = (await alice.post("/api/books", json={"title": "Dế Mèn"})).json()
        bid = book["id"]
        for seq in (2, 0, 1, 4, 3):
            r = await alice.post(
                f"/api/books/{bid}/pages", files={"image": ("p.jpg", page_image(seq), "image/jpeg")}, data={"seq": str(seq)}
            )
            assert r.status_code == 202

        chunks = await wait_all_done(alice, bid, 5)
        texts = [c["text"] for c in chunks]
        joined = " ".join(texts)
        assert [c["seq"] for c in chunks] == sorted(c["seq"] for c in chunks)
        assert "ngắt giữa chừng khi sang trang sau" in joined, "cross-page paragraph joined"
        assert joined.index("Chương một") < joined.index("Trang ba") < joined.index("Hết chương")
        assert all(len(t) <= 1500 for t in texts)
        assert list(ctx_of(app).settings.tmp_dir.iterdir()) == []
        assert azure.calls == [], "no provider fallback"
        assert any("Trang ba" in t for t, _ in gemini.calls[:-1]) or len(gemini.calls) > len(chunks)

        audio_url = chunks[0]["audio_url"]
        assert (await bob.get(audio_url)).status_code == 200
        assert (await bob.get(audio_url, headers={"Range": "bytes=0-99"})).status_code == 206
        assert len(library_files(app, bid)) == len(chunks)

        await alice.put(f"/api/books/{bid}/progress", json={"chunk_seq": 2, "offset_ms": 500})
        await bob.put(f"/api/books/{bid}/progress", json={"chunk_seq": 0, "offset_ms": 10})
        assert (await alice.get(f"/api/books/{bid}/progress")).json()["chunk_seq"] == 2
        assert (await bob.get(f"/api/books/{bid}/progress")).json()["chunk_seq"] == 0
        assert (await bob.patch(f"/api/books/{bid}", json={"tts_provider": "azure"})).status_code == 403
        assert (await bob.delete(f"/api/books/{bid}")).status_code == 403

        zf = zipfile.ZipFile(io.BytesIO((await bob.get(f"/api/books/{bid}/export")).content))
        assert len([n for n in zf.namelist() if n.endswith(".mp3")]) == len(chunks)
        assert len(json.loads(zf.read("text.json"))["chunks"]) == len(chunks)

        old_files = set(library_files(app, bid))
        assert (await alice.patch(f"/api/books/{bid}", json={"tts_provider": "azure"})).status_code == 200
        regenerated = await wait_all_done(alice, bid, 5)
        assert all(c["provider"] == "azure" for c in regenerated)
        assert len(azure.calls) == len(regenerated)
        new_files = set(library_files(app, bid))
        assert len(new_files) == len(regenerated) and not (new_files & old_files), "old voice files removed"

        assert (await alice.delete(f"/api/books/{bid}")).status_code == 204
        assert not (ctx_of(app).settings.library_dir / bid).exists()
    finally:
        await worker.stop()


async def test_restart_mid_pipeline_resumes_without_duplicates(alice, app):
    gemini = FakeTts("gemini")
    first = make_worker(app, gemini, FakeTts("azure"))
    ctx_of(app).worker = first
    await first.start()
    book = (await alice.post("/api/books", json={"title": "Khởi động lại"})).json()
    bid = book["id"]
    for seq in range(5):
        await alice.post(f"/api/books/{bid}/pages", files={"image": ("p.jpg", page_image(seq), "image/jpeg")}, data={"seq": str(seq)})
    await asyncio.sleep(0.15)
    await first.stop()
    await ctx_of(app).db.execute("UPDATE chunks SET status='processing' WHERE status='pending'")

    second = make_worker(app, gemini, FakeTts("azure"))
    ctx_of(app).worker = second
    await second.start()
    try:
        chunks = await wait_all_done(alice, bid, 5)
        assert len(library_files(app, bid)) == len(chunks)
    finally:
        await second.stop()
