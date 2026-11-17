"""GeminiTtsProvider: the client must target API v1beta, the only version that knows speechConfig."""

import pytest
from google.genai import types

from app.pipeline import tts_gemini
from app.pipeline.tts_gemini import GeminiTtsProvider


def test_client_targets_v1beta_so_speech_config_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, types.HttpOptions] = {}

    def fake_client(*, api_key: str, http_options: types.HttpOptions) -> object:
        captured["http_options"] = http_options
        return object()

    monkeypatch.setattr(tts_gemini.genai, "Client", fake_client)

    GeminiTtsProvider(api_key="test-key", model="test-model", style_prompt="")

    assert captured["http_options"].api_version == "v1beta"
