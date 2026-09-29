# Red-team plan review: Security Adversary + Fact Checker

Plan: `plans/260929-1636-smart-progress-and-voice-picker/` (plan.md + 8 phases). Code checked against the working tree, WIP usage/account files included.

## Fact-check of plan claims

| Claim | Result |
|---|---|
| `ensure_book_owner` exists and returns 403 | VERIFIED `app/auth/current_user.py:25-27` |
| `CurrentUser` returns 401 when there is no session | VERIFIED `app/auth/current_user.py:14-17` |
| `ctx.worker.wake()` works when the worker is off (no-op) | VERIFIED `app/app_context.py:23-28,47` |
| Grace branch in `claim_next_pending` = `sealed=1 OR (updated_at<=cutoff AND no uploaded/ocr_processing page)` | VERIFIED `app/repositories/chunk_repository.py:122-130` |
| `replace_tail` DELETE has no `sealed=0` guard (race is real) | VERIFIED `app/repositories/chunk_repository.py:86` |
| `get_unsealed_tail` filters `sealed=0` | VERIFIED `app/repositories/chunk_repository.py:67` |
| `pages_processing` = `uploaded|ocr_processing` | VERIFIED `app/repositories/book_repository.py:72` |
| The `cs` subquery puts `pending` into `processing` (root cause) | VERIFIED `app/repositories/book_repository.py:91` |
| Every `book_out` call site | VERIFIED: only 3, all in `app/api/books_routes.py:73,82,87` |
| `tail_seal_grace_seconds` | VERIFIED `app/config.py:44` (float; worker can override it via ctor, `app/pipeline/worker.py:99`) |
| `gemini_tts_voice="Kore"`, old style | VERIFIED `app/config.py:27-28` |
| Providers are only built inside `if settings.worker_enabled` | VERIFIED `app/main.py:56-64` |
| `Worker(tts_rpm_limiters=...)` already exists | VERIFIED `app/pipeline/worker.py:90,103` |
| `RpmLimiter` lives in `worker.py`, and importing it from `app_context` "may" cause a cycle | FAILED (it is not "may"): `worker.py:42` imports `AppContext`, so the split into `rpm_limiter.py` is required |
| `GEMINI_VOICES`/`AZURE_VOICES`/`_with_default` | VERIFIED `app/api/voices_routes.py:7-12` |
| Create/patch "maybe not validating" voice | VERIFIED as NOT validated: only `max_length=80`, `app/api/books_routes.py:28,35,93,119` |
| `quota_policies(...).configured` | VERIFIED `app/usage_quota.py:40-48` |
| `ctx.usage.record(service,outcome,chars,book_id)` | VERIFIED `app/repositories/provider_usage_repository.py:27` |
| `ApiError(headers=...)` | VERIFIED `app/api_errors.py:10,30` (the value is passed straight into `JSONResponse`) |
| `TtsError.quota/retry_after` | VERIFIED `app/pipeline/tts_provider.py:23-28` (`retry_after: float`) |
| Tests `test_patch_title_and_voice_resets_chunks`, `test_patch_same_voice_does_not_reset`, `test_voices_lists_defaults` | VERIFIED `tests/test_books_api.py:75,88,247` |
| `ctx_of(app)` | VERIFIED `tests/conftest.py:63`; tests clear env vars, so they never pick up a real key (`conftest.py:17-19`) |
| `tests/web/` | Does not exist yet (the plan creates it) |
| `scripts/voice_poc.py` has its own list | VERIFIED `scripts/voice_poc.py:32` (missing Charon/Orus, so the phase 8 PoC as written would not produce `gemini-Charon.mp3` until the script is fixed) |
| `voice-select`/`pickVoice`/`onChangeVoice` | VERIFIED `web/js/components/player-sheet.js:28,46,50,118` |
| `voicesApi.list()` in reader-view | VERIFIED `web/js/views/reader-view.js:134` |
| `timerRef` in book-status-view; link `#/read` | VERIFIED `web/js/views/book-status-view.js:16,153` |
| Route `#/listen/:id` | VERIFIED `web/js/app.js:2,27` |
| `stateInfo` in library-crate | VERIFIED `web/js/components/library-crate.js:9` |
| `reassignSeq`, `cam.vibrate` | VERIFIED `web/js/upload-queue.js:156`, `web/js/camera-capture.js:101` |
| A "disc slide-out" animation exists in `vinyl.css` | FAILED: only `@keyframes disc-spin`, `web/css/vinyl.css:45`, so a new keyframe is needed |
| The SW sends `/api` network-first without caching | VERIFIED `web/sw.js:131-140,161-164`; `SHELL_CACHE='booksnap-shell-v13'` `web/sw.js:6` |
| Single process (so an in-memory lock is enough) | VERIFIED `railway.json:7` (uvicorn has no `--workers`) |

---

## Finding 1: The preview endpoint lets any member exhaust the TTS RPM/RPD the worker shares
- **Severity:** High
- **Location:** Phase 3, sections "Requirements" (cache miss) and "Risk Assessment" ("Preview chiếm RPM của worker… khoảng 10 giọng × 1 lần trong cả vòng đời app")
- **Flaw:** The claim "10 calls over the app's lifetime" only holds if the provider always succeeds. The plan writes the cache **only on success** and has no negative cache, no per-user rate limit, and does not check the worker's pause state. The RpmLimiter is shared and blocking, so preview traffic takes slots away from the worker.
- **Failure scenario:** Gemini returns 5xx/400 (the preview model is overloaded, or an env default voice that the model rejects). The user keeps tapping ▶, or a script loops `GET /api/voices/gemini/Charon/preview`. Every request is one real provider call. It takes one of the 10 RPM slots (`gemini_tts_rpm=10`) that the 2 TTS loops need, so book processing stalls for the whole household. Each `error` counts toward RPD (`SUM(outcome != 'quota')`). After a 429 the worker pauses the provider for up to 1h, but preview ignores `_pause_until` and keeps hitting Gemini, which can stretch Google's rate-limit window.
- **Evidence:**
  - `app/pipeline/worker.py:65-72`: `throttle()` sleeps until a slot frees up, with no fairness.
  - `app/pipeline/worker.py:103`: one limiter per provider.
  - `app/pipeline/worker.py:107,240,289`: `self._pause_until` lives only inside the Worker.
  - `app/repositories/provider_usage_repository.py:35`: `SUM(outcome != 'quota') AS requests`.
  - `app/config.py:29`: `gemini_tts_rpm: int = 10`.
  - `app/api/usage_routes.py:12`: "every account shares the same API keys".
- **Suggested fix:**
  - Add a negative cache per key (for example 60s after `error`, and until `retry_after` after `quota`) and return 502/503 without calling the provider.
  - Add a per-user limit that reuses `RateLimiter` (`app/auth/rate_limiter.py:9-29`), e.g. 5 misses per minute per user.
  - Share the pause state: move `_pause_until` to `AppContext` or expose `worker.is_paused(provider)`, and have preview return 503 when paused.
  - Use a try-acquire limiter for preview: if the RPM is full, return 503 `tts_busy` immediately instead of sleeping inside the request.
  - Add tests: "3 failed requests in a row → provider called once", and "provider paused → no call".

## Finding 2: The per-key lock only dedupes success; on failure the waiters call the provider one after another, and the lock is held for about 3 minutes
- **Severity:** High
- **Location:** Phase 3, section "Requirements" ("Lock theo key… Request thứ 2 chờ lock rồi đọc cache") and the test "2 request đồng thời… fake gọi đúng 1 lần"
- **Flaw:**
  - If the first holder fails, no file is written. Each waiter then acquires the lock, sees a miss, and calls the provider again. N concurrent requests become N provider calls in sequence.
  - The lock is held across `throttle()` (up to 60s) plus the Gemini call (timeout 120s).
  - The synth is tied to the HTTP request's lifetime. With `@app.middleware("http")` (BaseHTTPMiddleware), a client disconnect can cancel the endpoint after the provider has already billed the call but before the file and usage row are written. The result is wasted quota and unmetered usage.
- **Failure scenario:** Chips on 3 open tabs, or a double-tap on iOS, send 5 requests while Gemini returns 500. That is 5 sequential calls, and the last request waits about 5×(throttle+latency). Separately, a user taps ▶ and then closes the sheet: the call is cancelled mid-flight, and the next tap synthesizes again.
- **Evidence:**
  - `app/pipeline/tts_gemini.py:15`: `GEMINI_TIMEOUT_MS = 120_000`.
  - `app/pipeline/worker.py:72`: `await asyncio.sleep(60.0 - (now - self._hits[0]))`.
  - `app/main.py:116-123`: BaseHTTPMiddleware wraps every request.
  - The test in phase 3 step 2 covers concurrency on success only.
- **Suggested fix:**
  - Use single-flight: store an `asyncio.Task`/`Future` per key. All waiters `await asyncio.shield(task)` and share the result **including the exception**, so the provider is called once per burst on both success and failure.
  - Run the synth as a task independent of the request, so disconnects don't cancel it, and record usage inside that task.
  - Put a server-side timeout on the request (for example 30s → 503 `tts_busy`).
  - Add a test: 2 concurrent requests + fake raises → fake called once, and both requests get 502.

## Finding 3: `Retry-After` is a float, so the 503 turns into a 500; the 502/503 body can leak the upstream error
- **Severity:** Medium
- **Location:** Phase 3, section "Requirements" → "Lỗi (dùng ApiError)"
- **Flaw:**
  - `TtsError.retry_after` is a `float`. `ApiError.headers` goes straight into `JSONResponse`, and Starlette calls `.encode("latin-1")` on header values, so a float raises and produces a 500 instead of a 503.
  - The plan doesn't say what `message` the client gets. The natural choice, `exc.message`, contains the raw upstream error: the Azure body (`response.text[:200]`), the Gemini `exc.message`, or `str(httpx exc)` (host/URL). A 500 also skips the 503 → "Hết lượt Gemini" UI branch.
- **Failure scenario:** Gemini answers 429 with `Retry-After: 30` → `_retry_after_seconds` returns `30.0` → `ApiError(503, headers={"Retry-After": 30.0})` → 500. The "503 + Retry-After" test only passes if the fake happens to use a str or int.
- **Evidence:**
  - `app/pipeline/tts_gemini.py:84-85`: `return float(raw)`.
  - `app/api_errors.py:30`: `JSONResponse(..., headers=exc.headers)`.
  - `app/pipeline/tts_azure.py:59`: `f"Lỗi Azure TTS ({response.status_code}): {response.text[:200]}"`.
  - `app/pipeline/tts_gemini.py:46,72-73`: embed `{exc}`/`{message}`.
- **Suggested fix:**
  - Use `headers={"Retry-After": str(math.ceil(retry_after))}`.
  - Always return a fixed Vietnamese message for `tts_failed`/`tts_quota`. Never forward `exc.message`; log it on the server only.
  - In the test, have the fake raise `retry_after=12.5` and assert the header is `"13"`.

## Finding 4: The Azure SSML injection sink stays open; the whitelist is framed as UX, skips stored data, and does not check `configured`
- **Severity:** Medium
- **Location:** Phase 2, sections "Requirements" (validate whitelist "Tại sao: … lỗi khó hiểu") and "Risk Assessment" ("Chỉ validate input mới, không validate dữ liệu đã lưu")
- **Flaw:**
  - `tts_voice` is interpolated unescaped into an SSML attribute. The only constraint today is `max_length=80`. Any member can create a book with `tts_provider=azure, tts_voice='x"/><audio src="https://evil/a.mp3"/><voice name="vi-VN-HoaiMyNeural'`. The worker then sends attacker-controlled SSML under the household's Azure key (for example making Azure fetch an external URL, or inflating characters), and the book is visible to everyone.
  - The plan whitelists only **new input** and leaves the sink (`_build_ssml`) as is. Rows written before the rollout keep being sent on every claim or retry.
  - The whitelist doesn't check that the provider is configured. PATCH `regenerate=false` to `azure` without a key passes and every new chunk goes `failed`, which breaks the success criterion "không đi tới worker".
- **Evidence:**
  - `app/pipeline/tts_azure.py:22`: `f'<voice xml:lang="vi-VN" name="{voice}">{escaped}</voice>'` (only the text is escaped, line 19).
  - `app/api/books_routes.py:28,35`: `Field(default=None, max_length=80)`.
  - `app/api/books_routes.py:93,119`: no validation.
  - `app/pipeline/worker.py:240`: `_available_providers` is based on `router.providers`, which always includes azure (`app/main.py:62`).
- **Suggested fix:**
  - Fix the sink too: `name={xml.sax.saxutils.quoteattr(voice)}`, or reject any voice that doesn't match `^[A-Za-z0-9-]+$` inside `AzureTtsProvider.synthesize`.
  - In the worker, before synth, check `voice in allowed_voices(...)` and mark the chunk `failed` if it isn't.
  - In create/patch, return 409 `provider_unavailable` when `quota_policies(...)[..].configured` is false, the same as preview.
  - Add a test with a voice that contains `"` → 422.
  - Also, the preview test for `../x` is a phantom test: Starlette matches `{voice}` as `[^/]+`, so it returns 404 through the router and never reaches the whitelist. Use `Kore%22` or `NotAVoice` instead.

## Finding 5: seal-tail is owner-only while upload/discard/retry/edit are open to every member, so the authz model contradicts itself
- **Severity:** Medium
- **Location:** Phase 1, section "Requirements" (`POST seal-tail: chỉ owner`); Phase 6, "Nút Xong rồi, đọc luôn" (`tail_waiting && book.can_manage`); Phase 4, the non-owner existing-book panel
- **Flaw:**
  - In the shared library, any member can add pages to someone else's book (Phase 4 lets a non-owner go straight to the camera), discard pages, retry, and edit chunk text. None of these check the owner.
  - Only seal-tail is owner-only. The person actually capturing (a non-owner) never sees the button and still waits the 90s. That is exactly the bug this plan exists to fix.
  - If the implementer "fixes" it by opening seal to everyone without a policy decision, any member can seal a book the owner is still photographing. There is no "who uploaded" data to limit it by, since pages have no uploader column.
- **Evidence:**
  - `app/api/pages_routes.py:43`: `await load_book(ctx, book_id)` with no owner check.
  - `app/api/pages_routes.py:74,89`: the same for discard/retry.
  - `app/api/audio_routes.py:22-28`: `patch_chunk` has no owner check.
  - `app/api/books_routes.py:109`: owner-only is used only for PATCH/DELETE.
- **Suggested fix:** Make an explicit decision and record it in Phase 1:
  - (a) Seal is a pipeline operation like discard/retry → open to every member, with `user_id` in the log (already planned). The button uses `tail_waiting` without `can_manage`.
  - (b) Keep it owner-only and accept that non-owners wait 90s, with that written into the AC.
  - Either way, add a test for the non-owner case that matches the chosen policy.

## Finding 6: `Cache-Control: private, max-age=86400` on a URL that doesn't encode the cache key serves stale previews after a style/model change
- **Severity:** Medium
- **Location:** Phase 3, "Cache hit → FileResponse… max-age=86400"; Phase 8, Railway `GEMINI_TTS_STYLE` change
- **Flaw:**
  - The server cache key includes style/model, but the URL `/api/voices/{p}/{v}/preview` doesn't. For 24h the browser won't revalidate and keeps playing audio made with the old prompt.
  - Phase 8 changes the style on prod, so right after deploy users hear the old preview, while the book is synthesized with the new style.
  - This breaks the existing pattern: chunk audio only uses a long cache because its URL carries `?v=hash`.
- **Evidence:**
  - `app/api/audio_routes.py:51-52`: "URL carries ?v=<content hash>, so a given URL always maps to the same bytes" + `max-age=31536000, immutable`.
  - `app/api/serializers.py:90`: `audio_url` includes `?v=`.
- **Suggested fix:**
  - Have `/api/voices` return a `preview_url` for each voice containing `?v={key}` (additive field). Only that URL gets a long max-age.
  - Or use `Cache-Control: private, no-cache` and rely on the ETag that FileResponse sets automatically.

## Finding 7: The frontend objectURL lifecycle contradicts itself, and it doesn't guard against caching error responses or offline 503s
- **Severity:** Medium
- **Location:** Phase 4, sections "Requirements" (VoicePicker) and "Architecture" (`voicesApi.previewUrl`)
- **Flaw:**
  1. "Cache objectURL trong Map cấp module, sống hết phiên trang" contradicts "Unmount thì dừng phát và **revoke URL**". After a revoke, the next mount reads a dead URL from the Map, `audio.play()` fails, and Success Criterion "lần 2 phát ngay" is broken.
  2. A raw `fetch` bypasses `apiFetch`, so a 401 doesn't fire `UNAUTHORIZED_EVENT`. When the session expires the chip just shows "Không nghe thử được".
  3. The plan doesn't require `res.ok` + `content-type: audio/mpeg` before `blob()` and caching. A careless implementation stores the JSON error body as a blob in the Map for the whole session.
  4. When offline, the SW returns a synthetic 503 `{code:'offline'}`, and the plan maps every 503 to "Hết lượt Gemini", which is wrong.
  5. `signOut` doesn't reload the page, so the Map survives a change of account (low sensitivity, but the lifecycle has no owner).
- **Evidence:**
  - `web/js/api-client.js:39-51`: 401 handling and the `res.ok` check exist only in `apiFetch`.
  - `web/sw.js:131-139`: offline returns 503 `code:'offline'`.
  - `web/js/sign-out.js:5-16`: no reload and no module state cleared.
- **Suggested fix:**
  - Revoke only when evicting from the Map. On unmount, only pause and detach `src`.
  - Wrap the fetch in `voicesApi.previewBlob()` inside `api-client.js` so the 401 event is reused. Throw `ApiError` when `!res.ok`, and cache only 200 `audio/*` responses.
  - Map errors by `error.code` (`tts_quota`, `provider_unavailable`, `offline`), not by status.
  - Clear the Map on `signOut`.

## Finding 8: Preview usage can't be attributed to anyone (no user_id in usage or logs), so abuse from Finding 1 can't be traced
- **Severity:** Medium
- **Location:** Phase 3, "Mọi lần gọi provider đều ghi usage… book_id=None" and "Log: voice_preview provider=%s voice=%s cache_hit=%s ms=%d outcome=%s"
- **Flaw:**
  - `provider_usage` has no `user_id` column, and preview writes `book_id=NULL`. The planned log line has no `user_id` either.
  - `/api/usage` only shows household totals. When RPD runs out there is no way to tell whether a person or a script caused it through preview, even though the current routes all log `user_id` for mutations.
- **Evidence:**
  - `app/db.py:119-126`: schema `service, outcome, chars, book_id, created_at`.
  - `app/api/pages_routes.py:67`: `page_uploaded … user_id=%s`.
  - `app/api/books_routes.py:97`: `book_created … user_id=%s`.
- **Suggested fix:** Add `user_id=%s` to the `voice_preview` log line (don't add a migration; the plan already commits to "không thêm migration"). Only log when the provider is actually called (a miss); a hit shouldn't spam. Consider putting `service='gemini_tts'` together with a `preview` tag in the log so ops can grep for it.

## Finding 9: `regenerate=false` and title/topic edits bump `books.updated_at`, which resets the grace window; `tail_ready_at` then becomes wrong and the countdown jumps
- **Severity:** Medium
- **Location:** Phase 2, `set_voice_for_new_content`: "`UPDATE books SET tts_provider=?, tts_voice=?, updated_at=?`"; Phase 1, `tail_ready_at = books.updated_at + grace`
- **Flaw:**
  - `books.updated_at` does two jobs: it is the "last pipeline activity" timestamp that grace depends on, and the "last metadata edit" timestamp.
  - Phase 4 has the client PATCH the voice before opening the camera, and Phase 2 bumps `updated_at`. Every voice/title/topic change pushes the tail synth back by another 90s, and the countdown in Phase 6 jumps back up.
  - Any member can repeatedly edit a book's chunk or discard pages (`touch`), which delays the owner's tail indefinitely. This is a low-grade griefing DoS.
- **Evidence:**
  - `app/repositories/book_repository.py:117,138,149-150,159`: `set_topic`, `update_title`, `change_voice`, and `touch` all write `updated_at`.
  - `app/repositories/chunk_repository.py:125`: `b.updated_at <= ?` is the grace condition.
  - `app/api/pages_routes.py:81`: discard calls `touch`, open to every member.
- **Suggested fix:**
  - `set_voice_for_new_content` shouldn't bump `updated_at`, or should explicitly accept the reset.
  - Add a Phase 1 test: "PATCH regenerate=false does not extend tail_ready_at".
  - Longer term: a separate `books.last_activity_at` column for grace (that needs a migration, so defer it and record it under Risk).

---

## Unresolved questions
1. seal-tail policy: open to every member (like discard/retry) or owner-only? (Finding 5, needs a product decision)
2. Should preview have a hard daily cap (for example ≤ N preview misses per Pacific day) that is separate from the book RPD?
3. Can `AppContext` hold the provider pause state (`_pause_until`) so preview can read it, or should it stay private to the Worker?

Status: DONE_WITH_CONCERNS
Summary: The plan's facts are mostly accurate (1 claim false: the RpmLimiter circular import is certain, not "may"; vinyl.css has no slide-out animation). The preview endpoint has 2 High findings (no negative cache or per-user limit, so it steals the shared RPM/RPD and ignores the provider pause; the per-key lock doesn't dedupe failures and ties the paid synth to the request lifetime), plus 7 Medium findings (Retry-After float → 500 and upstream error leak, unfixed SSML sink, seal-tail authz inconsistent with the shared model, stale 24h preview cache, objectURL lifecycle, preview usage not attributable, grace reset by metadata edits).
