# Phase 2 — OCR + TTS pipeline: implementation report

Date: 2026-09-29

## Status
All tests pass (88 passed; 63 original + 25 new). `python -c "import app.main"` OK. `python scripts/voice_poc.py --help` OK. No network calls in tests (Gemini/Azure providers only exercised via fakes).

## Files created
- `app/pipeline/text_chunker.py` — pure sentence-split + merge chunker (400/1200/1500 chars).
- `app/pipeline/ocr_provider.py` — `PageText`, `OcrError`, `OcrProvider` Protocol.
- `app/pipeline/ocr_gemini.py` — Gemini OCR via `client.aio`, `response_schema` (pydantic), temp 0.
- `app/pipeline/tts_provider.py` — `SynthResult`, `TtsError` (retryable/quota/retry_after), `TtsProvider` Protocol.
- `app/pipeline/tts_gemini.py` — Gemini TTS (`response_modalities=["AUDIO"]`, prebuilt voice) → PCM → `audio_encoding`.
- `app/pipeline/tts_azure.py` — Azure REST SSML (httpx), `audio-24khz-48kbitrate-mono-mp3`.
- `app/pipeline/audio_encoding.py` — `lameenc` PCM16→MP3 + duration_ms.
- `app/pipeline/tts_router.py` — provider dispatch + backoff retry (2s/8s/30s, injectable) + `content_hash()` (D6).
- `app/pipeline/chunker_worker.py` — page→chunk folding tick (ordering invariant, tail sealing), extracted out of `worker.py` to keep it under ~200 lines-ish.
- `app/pipeline/cleanup_worker.py` — TTL image expiry + orphan tmp-file sweep, likewise extracted.
- `app/pipeline/worker.py` — `Worker` class: lifecycle (`start`/`stop`/`resume`/`wake`), N OCR loops, N TTS loops, 1 chunk loop, 1 cleanup loop, in-memory per-provider quota pause + soft RPM limiter (`RpmLimiter`).
- `scripts/voice_poc.py` — CLI, OCRs images then synthesizes a ~600-char sample with 4 Gemini voices + 2 Azure voices; UTF-8 stdout reconfigure so `--help` works on Windows consoles (cp1252 crashed on Vietnamese text otherwise).
- `tests/test_text_chunker.py` (12 tests), `tests/test_tts_router.py` (4), `tests/test_worker_resume.py` (7).

## Files modified
- `app/config.py`: added `gemini_ocr_rpm`, `tail_seal_grace_seconds` (90s default), `cleanup_interval_seconds` (3600s), `worker_enabled` (bool, default True — tests flip it off).
- `app/main.py`: lifespan builds `Worker` with real Gemini/Azure providers when `worker_enabled`, assigns `ctx.worker`, `await worker.start()` / `await worker.stop()`.
- `app/repositories/page_repository.py`: added `claim_next_uploaded`, `mark_ocr_done`, `mark_failed`, `resume_processing`, `list_unchunked`, `mark_chunked`, `list_failed_with_expired_image`, `clear_image`, `all_image_paths`. No existing signatures touched.
- `app/repositories/chunk_repository.py`: added `TailBusyError`, `get_unsealed_tail`, `next_free_seq`, `replace_tail`, `claim_next_pending`, `mark_done`, `mark_waiting_quota`, `mark_failed`, `requeue_expired_quota`, `resume_processing`. No existing signatures touched.
- `tests/conftest.py`: one line — `settings` fixture now passes `worker_enabled=False` (per your instruction) so the app's own background worker never races the phase-1 tests' assumptions about page/chunk state right after upload.

## Schema changes
None. Everything phase-1 already added (`pages.chunked`, `chunks.sealed`, `content_hash`, `not_before`, `provider`, `voice`, `audio_path`, `duration_ms`, `attempts`, `error`) was sufficient.

## Tail-chunk sealing design (as required by the spec)
The chunker only ever rewrites the single `sealed=0` chunk (always highest `seq` in the book) — `ChunkRepository.replace_tail`. Each chunk_tick: for each book with unchunked pages, walk pages in `seq` order from the last already-chunked page; incorporate `ocr_done` pages' text into a `carry` string (joining without a blank line when the previous page's `continues=1`, else with `"\n\n"`); stop at the first page that is neither `ocr_done` nor a "dead" `failed`-with-no-image page (dead pages are marked `chunked=1` too, so they're permanently skipped and never stall the book — a `failed` page whose image is still present blocks, as required). Re-split `carry` via the pure `text_chunker.chunk_text`; all pieces but the last get `sealed=1` (a later chunk now exists after them) written as new rows; the last becomes the new unsealed tail (old tail row deleted+reinserted so it gets a fresh id — acceptable since it was never `done`).

`ChunkRepository.claim_next_pending` encodes the TTS eligibility rule directly in one atomic `UPDATE ... RETURNING`: a `pending` chunk is claimable iff `sealed=1`, OR (`books.updated_at <= now - tail_seal_grace_seconds` AND no page in that book is `uploaded`/`ocr_processing`). `books.updated_at` is touched by the worker on every OCR completion and every chunk-tick that changes something (plus the existing page-upload/title/voice-change touches from phase 1), so the grace window is based on persisted activity and survives restarts (worst case: last touch was right before a crash, so the tail waits the full grace period again after resume — never picked up early).

Race guard: if the TTS worker claims the tail chunk (`status='processing'`) between the chunker's read and its `replace_tail` write, the `DELETE ... WHERE id=? AND status='pending'` inside the transaction affects 0 rows and raises `TailBusyError`; the chunker just skips that book this tick and retries on the next one/next wake.

## Other design notes
- Retry policy: OCR and TTS both retry 5xx/timeout/network errors with backoff `(2s, 8s, 30s)` (injectable everywhere tests need speed) — 1 initial attempt + 3 retries = 4 total calls, matching "tối đa 3 lần". Quota (429) is NOT retried inline; it's classified immediately so the chunk goes to `waiting_quota` and the whole provider is paused (in-memory `Worker._pause_until`) until `not_before`.
- `not_before`/pause timestamps come from `app.db.now_iso()`, which truncates to whole seconds. A `retry_after < 1s` would round to the same second as "now" and the pause would be ineffective — not an issue in practice (real `Retry-After` values are seconds/minutes/hours), documented in `test_tts_router.py`'s comment; flagging as a known granularity limit rather than a bug.
- Content-hash cache (D6): computed at claim time from `(text, provider, voice)`; if it matches the chunk's stored `content_hash` AND the expected file (`{seq:05d}-{hash[:8]}.mp3`) exists on disk, the provider is never called — `mark_done` reuses the existing `duration_ms`.
- New audio is written to a `.tmp-<uuid>.mp3` sibling then `os.replace`'d into place; if `mark_done`'s `UPDATE ... WHERE status='processing'` affects 0 rows (chunk/book deleted mid-synthesis), the just-written file is deleted. The previous audio file (different hash) is deleted only after the DB row is confirmed updated.
- Soft RPM limiting: `RpmLimiter` (sliding 60s window, in-memory) — one instance for OCR (`gemini_ocr_rpm`, new setting) and one per TTS provider (`gemini_tts_rpm`/`azure_tts_rpm`, already existed). Not persisted across restarts (matches phase 1's `RateLimiter` design philosophy — single replica, acceptable per plan).
- Worker composition: N OCR-loop coroutines + N TTS-loop coroutines (each an independent claim→process→claim loop, bounded by `ocr_concurrency`/`tts_concurrency`) + 1 chunk loop + 1 cleanup loop, all woken by a shared `asyncio.Event` (`wake()`) with a `poll_seconds` timeout fallback. `stop()` cancels every task and awaits them; in-flight `ocr_processing`/`processing` rows are simply left as-is by cancellation and picked up by the next `resume()` (startup), matching "Shutdown: cancel tasks cleanly; in-flight items return to their waiting state (on next startup at the latest)".
- Modularized `worker.py` (was ~394 lines) by extracting the chunk-folding tick into `chunker_worker.py` and the TTL/orphan cleanup into `cleanup_worker.py`. `worker.py` is still ~312 lines (large module docstring + OCR/TTS loops sharing mutable state like `_pause_until` and the RPM limiters) — judged not worth splitting further at the cost of threading shared state through extra modules; noted here per the "consider modularization" rule rather than silently ignored.

## Unverified / needs real API keys
- `ocr_gemini.py` / `tts_gemini.py` / `tts_azure.py` are never called with real credentials in the test suite (by design — "No network in tests"). SDK shapes (`response.parsed`, `types.Part.from_bytes`, `SpeechConfig`/`VoiceConfig`/`PrebuiltVoiceConfig`, `genai_errors.APIError.code`) were verified by reading the installed `google-genai` 2.25 source, not by a live call.
- `scripts/voice_poc.py` step 1 of the phase ("user nghe và chốt voice + style prompt", "ghi lại quota thực tế") still needs to be run by hand with real `GEMINI_API_KEY`/`AZURE_SPEECH_KEY` and real page images — outside this agent's capability (no keys available). The script is import-clean and `--help` works.
- Real Gemini TTS inline_data mime_type (e.g. exact `audio/L16;rate=24000` string) wasn't observable without a live call; `tts_gemini.py` doesn't parse the mime type, it hard-codes `SAMPLE_RATE=24000` per the spec, so this is low-risk but worth a quick sanity check during the PoC run.
- Azure `Retry-After` header presence/format on 429 responses is assumed to be a plain integer-seconds string per Azure docs; not verified live.

## Unrelated observation (not my scope)
`tests/test_export_and_storage_health.py` (imports `app.api.export_routes`, `app.storage_health` — neither exists yet) appeared in the repo during this session and its 3 tests fail; this is phase-5 (export/deploy) scope being worked on in parallel by someone/something else, not part of phase 2's file ownership. Left untouched. The original 63 tests plus all 25 new ones (88 total) pass; only ignoring that one foreign file gives a clean `86 passed`.

## Open questions
1. Real quota numbers (Gemini TTS/Flash RPM/RPD, Azure F0) still need to be measured via the PoC run with real keys (plan's own open question #1, unresolved by design — needs human + keys).
2. Voice/style prompt final choice ("user nghe và chốt") likewise pending a real PoC run.
