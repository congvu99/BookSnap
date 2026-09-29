# Code Review: Backend phases 1-3 (tail waiting / seal-tail / default voice, PUT voice, voice preview)

## Scope
- Files: app/repositories/{book,chunk}_repository.py, app/api/{serializers,books_routes,voices_routes}.py, app/tts_voices.py (new), app/voice_preview.py (new), app/app_context.py (voice_preview only), app/config.py (Charon line only), app/pipeline/tts_{gemini,azure}.py, scripts/voice_poc.py, tests/test_{tail_seal,voice_change,voice_preview}.py, tests/test_books_api.py (1 edit)
- Excluded: account/usage-quota WIP, frontend (phase 4 WIP in web/js, tests/web).
- Tests: `.venv/Scripts/python -m pytest -q` -> **175 passed, 1 failed**. Failure = `tests/test_service_worker_assets.py::test_every_script_and_stylesheet_is_precached` caused by untracked `web/js/voice-labels.js` (phase-4 frontend WIP, not in sw.js precache). Not caused by backend changes; the 35 new backend tests pass in isolation. Suite is not green as a whole right now.
- ruff/mypy not installed in .venv -> no lint/type run.

## Overall
Backend matches the phase specs closely. SQL for `queued`/`tail_pending` is equivalent to the plan formula (sealed is `NOT NULL DEFAULT 0`). Race guard `sealed=0` correct; chunker handles TailBusyError (chunker_worker.py:68) and next tick starts new seq. API changes are additive except the intended 400/409 validation. Issues below are mostly edge-case robustness and test gaps.

## Critical
None.

## High
None.

## Medium

M1. PATCH partial write on validation failure - app/api/books_routes.py:146-157
- `update_title` / `set_topic` execute before `_checked_voice` raises 400.
- Scenario: old client PATCH `{title:"New", tts_voice:"Bad"}` -> 400 returned but title (and `updated_at`, which restarts tail grace) already persisted. Before this change PATCH never failed after writing.
- Fix: compute provider/voice and call `_checked_voice` before any write (validate-then-mutate).

M2. VoicePreviewService: non-TtsError failures escape the error contract - app/voice_preview.py:157-181
- `await self.usage.record(...)` inside the `except` blocks, and `tmp.write_bytes`/`os.replace`/`mkdir` on the success path, can raise (SQLite locked/busy, disk full, permission). Those raise raw exceptions, not PreviewError.
- Scenarios: (a) usage insert fails after provider error -> failure NOT cached, route does not catch -> 500; next request re-calls the provider (only per-user cap stops it). (b) usage insert fails after a paid successful synth -> mp3 never written, the paid call is thrown away, retry pays again. (c) disk full -> 500 every time, never failure-cached.
- Fix: write the file first, then record usage in `try/except Exception: log.exception(...)` (metering must not fail the operation); wrap the file write so OSError maps to `PreviewError("tts_failed")` + `_remember_failure`.

M3. Missing phase-1 acceptance test - tests/test_tail_seal.py
- Plan test "Sau seal-tail, upload + OCR thêm trang -> nội dung mới vào seq mới; text chunk cũ không đổi" is absent. The parametrized race test only proves `replace_tail` raises; nothing proves the chunker's next tick (get_unsealed_tail -> None -> next_free_seq) appends a new chunk without touching the sealed one, end to end through `chunker_worker.chunk_tick`.
- Fix: add test: tail sealed via endpoint, insert an `ocr_done` page not yet chunked, run `chunker_worker.chunk_tick(ctx)`, assert old chunk text/seq unchanged and new chunk at seq+1.

## Low

L1. PUT /voice validates before the no-op check - app/api/books_routes.py:169-171
- Re-submitting the book's current voice returns 400/409 if that stored voice has dropped off the whitelist (env default changed) or its non-default provider lost its key. Contradicts tts_voices.py docstring ("voices already stored keep working"). Phase 4 only calls PUT when changed, so low impact.
- Fix: `if (provider, voice) == current: return detail` before `_checked_voice`.

L2. Test-only hook in production code - app/voice_preview.py:107-109
- `is_configured` duck-types a `configured` attribute that no real provider defines; only the fake has it. Real path is always `provider_configured`. Dead branch in prod, widens behavior via getattr.
- Fix: use `provider_configured(self.settings, name)` only; tests already set keys via monkeypatch (or give the fake settings key).

L3. In-flight preview tasks not drained on shutdown - app/voice_preview.py:139
- Tasks live past request and lifespan; on shutdown the DB closes under them -> usage.record raises, exception swallowed by `_on_done`, possible "Task was destroyed but it is pending". Harmless data-wise.
- Fix (optional): `async def aclose()` cancelling `_inflight`, called from lifespan. Plan said no lifespan change, so acceptable to document.

L4. `preview_url` does not URL-encode voice - app/voice_preview.py:117
- Env-configured default voice outside the list (allowed by `allowed_voices`) with space/`#`/`?` yields a broken URL. Fix: `urllib.parse.quote(voice, safe="")`.

L5. 429 `Retry-After` not asserted - tests/test_voice_preview.py:115-121
- Code path is correct (ceil of RateLimiter float) but untested; the float->500 bug class this guards against was a Red Team finding. Add header assertion.

L6. `seal-tail` wake not asserted; `tail_waiting` true while the provider is quota-paused (worker `_pause_until`) or book has `waiting_quota` chunks -> countdown sits at 0. Documented in phase-1 risk; phase 6 must rank quota/error above tail state.

L7. scripts/voice_poc.py:102 default `--voices` now 8 Gemini voices (was 6) -> more paid calls on a bare run near 10 RPM free tier. Cosmetic.

## Acceptance check (phases 1-3)
- P1: queued/tail_waiting in list+detail, tail_wait_seconds detail-only, seal-tail 204/idempotent/any member/404/401, wake, log line, `sealed=0` guard + TailBusyError docstring, Charon default, style unchanged, PoC CLI - met. Test gap M3.
- P2: PUT /voice owner-only, set_voice leaves updated_at + chunks, wake, log; PATCH regenerate kept (+whitelist only); 400 unknown_voice / 409 provider_unavailable (non-default only, documented deviation); `configured` in /api/voices; quoteattr SSML + parse test - met. M1 new regression in PATCH.
- P3: 401/404/409, fixed text, key from provider instance (model/style/text), versioned preview_url, immutable Cache-Control, single-flight via shield+wait_for(30s), failure cache 60s / quota Retry-After ceil, per-user 6/min on miss only, fixed messages, atomic tmp+replace, usage row book_id NULL, log line - met. Robustness gap M2.

## Touchpoints / contracts
- book_out callers (books_routes.py:93,103,108): all via `_SUMMARY_SQL`, new fields populated; no other BookSummary construction. Response changes additive (`chunks.queued`, `chunks.tail_waiting`, `chunks.tail_wait_seconds`, provider `configured`, `preview_urls`). `/api/voices` `default` via `default_voice()` identical to old values; voice lists same set (order changed: Charon first) - old clients using list order for display will reorder, not break.
- claim_next_pending unchanged; set_voice picked up at claim (tested).
- Contract tightening (intended): create/PATCH with unknown voice -> 400; create with unconfigured non-default provider -> 409 (previously accepted, chunks then failed in worker).

## Concurrency notes (VoicePreviewService) - verified OK
- No await between is_file / failure / inflight checks -> single-loop atomic single-flight.
- Strong ref held in `_inflight` until done callback; callback retrieves exception.
- wait_for cancels only the shield wrapper; client disconnect likewise. Py 3.12: asyncio.TimeoutError is TimeoutError.
- Service per AppContext; conftest builds app per test (function loop scope) -> no cross-loop task reuse.
- Rate limit charged once per new task; joiners and cache hits free; different users sharing one task charged once.
- Path: filename = hex hash; provider/voice whitelisted before use; no client text. Error bodies fixed strings; provider text only in server log.

## Recommended actions
1. M1: validate voice before title/topic writes in PATCH.
2. M2: make usage metering non-fatal and map file-write errors to cached PreviewError.
3. M3: add chunker end-to-end test after seal-tail.
4. Fix sw.js precache for web/js/voice-labels.js (phase 4 owner) to restore full-suite green.
5. Low items at discretion.

## Unresolved questions
- Should PUT /voice be a no-op (200) for an unchanged but no-longer-whitelisted voice (L1), or is 400 intended?
- Is the full-suite red (sw precache) owned by the phase-4 session, or should it block marking phases 1-3 done?

Status: DONE_WITH_CONCERNS
Summary: Phases 1-3 backend meet acceptance criteria with additive contracts and sound single-flight concurrency; fix PATCH partial-write on validation failure (M1), non-fatal usage metering/file-write error mapping in preview (M2), and add the missing chunker-after-seal test (M3). Full suite 175/176, sole failure from untracked phase-4 frontend file.
