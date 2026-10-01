"""Voice preview endpoint: fixed sample text, disk cache, single-flight, failure cache, per-user cap."""

import asyncio

import pytest

from app.pipeline.tts_provider import SynthResult, TtsError
from app.voice_preview import PREVIEW_TEXT
from tests.conftest import ctx_of

URL = "/api/voices/gemini/Charon/preview"


class FakePreviewTts:
    name = "gemini"
    configured = True

    def __init__(self, *, error: TtsError | None = None, delay: float = 0.0, style: str = "style-a") -> None:
        self.error = error
        self.delay = delay
        self.model = "fake-model"
        self.style = style
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: str) -> SynthResult:
        self.calls.append((text, voice))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return SynthResult(mp3=b"ID3" + voice.encode(), duration_ms=1234)


@pytest.fixture
def use_fake(app):
    def install(fake: FakePreviewTts) -> FakePreviewTts:
        ctx_of(app).voice_preview.provider_factory = lambda name: fake
        ctx_of(app).voice_preview.reset_providers()
        return fake

    return install


async def usage_rows(app):
    return await ctx_of(app).db.fetchall("SELECT service, outcome, book_id FROM provider_usage")


async def test_requires_login(anon):
    assert (await anon.get(URL)).status_code == 401


@pytest.mark.parametrize("url", ["/api/voices/gemini/NotAVoice/preview", "/api/voices/gemini/Kore%22/preview", "/api/voices/polly/Kore/preview"])
async def test_unknown_voice_or_provider_is_404(alice, use_fake, url):
    fake = use_fake(FakePreviewTts())
    assert (await alice.get(url)).status_code == 404
    assert fake.calls == []


async def test_unconfigured_provider_is_409(alice):
    r = await alice.get("/api/voices/azure/vi-VN-NamMinhNeural/preview")
    assert r.status_code == 409 and r.json()["error"]["code"] == "provider_unavailable"


async def test_first_call_synthesizes_fixed_text_then_serves_from_cache(alice, app, use_fake):
    fake = use_fake(FakePreviewTts())
    first = await alice.get(URL)
    assert first.status_code == 200 and first.headers["content-type"] == "audio/mpeg"
    assert first.content == b"ID3Charon"
    assert "immutable" in first.headers["cache-control"]
    second = await alice.get(URL)
    assert second.status_code == 200 and second.content == b"ID3Charon"
    assert fake.calls == [(PREVIEW_TEXT, "Charon")]
    assert [dict(r) for r in await usage_rows(app)] == [{"service": "gemini_tts", "outcome": "ok", "book_id": None}]


async def test_concurrent_cold_requests_call_provider_once(alice, use_fake):
    fake = use_fake(FakePreviewTts(delay=0.05))
    a, b = await asyncio.gather(alice.get(URL), alice.get(URL))
    assert a.status_code == b.status_code == 200
    assert len(fake.calls) == 1


async def test_concurrent_failures_share_one_call_and_are_cached(alice, app, use_fake):
    fake = use_fake(FakePreviewTts(delay=0.05, error=TtsError("upstream said: secret-detail", retryable=True)))
    a, b = await asyncio.gather(alice.get(URL), alice.get(URL))
    assert a.status_code == b.status_code == 502
    assert a.json()["error"]["code"] == "tts_failed"
    assert "secret-detail" not in a.text
    third = await alice.get(URL)
    assert third.status_code == 502 and len(fake.calls) == 1
    assert [r["outcome"] for r in await usage_rows(app)] == ["error"]
    assert not list(ctx_of(app).voice_preview.cache_dir.glob("*")), "no cache or temp file left behind"


async def test_quota_error_returns_503_with_integer_retry_after(alice, app, use_fake):
    fake = use_fake(FakePreviewTts(error=TtsError("429", retryable=False, quota=True, retry_after=12.5)))
    r = await alice.get(URL)
    assert r.status_code == 503 and r.json()["error"]["code"] == "tts_quota"
    assert r.headers["retry-after"] == "13"
    again = await alice.get(URL)
    assert again.status_code == 503 and len(fake.calls) == 1
    assert [r["outcome"] for r in await usage_rows(app)] == ["quota"]


async def test_slow_provider_times_out_without_cancelling_the_synthesis(alice, app, use_fake, monkeypatch):
    monkeypatch.setattr("app.voice_preview.WAIT_TIMEOUT_SECONDS", 0.05)
    fake = use_fake(FakePreviewTts(delay=0.2))
    r = await alice.get(URL)
    assert r.status_code == 503 and r.json()["error"]["code"] == "tts_timeout"
    await asyncio.sleep(0.3)
    assert (await alice.get(URL)).status_code == 200
    assert len(fake.calls) == 1


async def test_family_cap_on_provider_calls(alice, bob, use_fake):
    use_fake(FakePreviewTts())
    voices = ["Charon", "Orus", "Fenrir", "Puck", "Kore", "Aoede", "Leda"]
    codes = [(await alice.get(f"/api/voices/gemini/{v}/preview")).status_code for v in voices]
    assert codes == [200] * 6 + [429]
    assert (await alice.get(URL)).status_code == 200, "cache hits are not capped"
    # Profiles share the family's budget: switching profile doesn't buy more paid previews.
    assert (await bob.get("/api/voices/gemini/Leda/preview")).status_code == 429


async def test_cache_key_follows_provider_style(app, use_fake):
    service = ctx_of(app).voice_preview
    use_fake(FakePreviewTts(style="style-a"))
    key_a = service.cache_key("gemini", "Charon")
    use_fake(FakePreviewTts(style="style-b"))
    assert service.cache_key("gemini", "Charon") != key_a


async def test_voices_list_exposes_versioned_preview_urls(alice, app, use_fake):
    use_fake(FakePreviewTts())
    body = (await alice.get("/api/voices")).json()
    url = body["providers"]["gemini"]["preview_urls"]["Charon"]
    assert url.startswith("/api/voices/gemini/Charon/preview?v=")
    assert (await alice.get(url)).status_code == 200


async def test_usage_record_failure_does_not_break_a_paid_preview(alice, app, use_fake, monkeypatch):
    use_fake(FakePreviewTts())

    async def boom(*args, **kwargs):
        raise RuntimeError("db locked")

    monkeypatch.setattr(ctx_of(app).voice_preview.usage, "record", boom)
    r = await alice.get(URL)
    assert r.status_code == 200 and r.content == b"ID3Charon"
    assert list(ctx_of(app).voice_preview.cache_dir.glob("*.mp3"))


async def test_cache_write_failure_is_502_and_remembered(alice, app, use_fake, monkeypatch):
    fake = use_fake(FakePreviewTts())

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr("app.voice_preview.os.replace", broken_replace)
    first = await alice.get(URL)
    assert first.status_code == 502 and first.json()["error"]["code"] == "tts_failed"
    assert (await alice.get(URL)).status_code == 502 and len(fake.calls) == 1
    assert not list(ctx_of(app).voice_preview.cache_dir.glob("*")), "no temp file left behind"


async def test_rate_limited_response_has_integer_retry_after(alice, use_fake):
    use_fake(FakePreviewTts())
    for v in ["Charon", "Orus", "Fenrir", "Puck", "Kore", "Aoede"]:
        await alice.get(f"/api/voices/gemini/{v}/preview")
    r = await alice.get("/api/voices/gemini/Leda/preview")
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    assert r.headers["retry-after"].isdigit()
