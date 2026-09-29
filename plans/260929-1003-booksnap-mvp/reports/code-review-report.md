# Code Review — BookSnap MVP (full repo)

Date: 2026-09-29 · Reviewer: code-reviewer · Mode: read-only (no code edited)

## Scope
- Files: `app/**` (32 py), `web/**` (sw.js, 24 js, 5 css, html, manifest), `tests/**`, `scripts/voice_poc.py`, `railway.json`, `.python-version`, `requirements*.txt`
- LOC: ~7.5K (app ~2.4K, web ~2.9K, tests ~1.1K)
- Focus: full MVP, pre-landing
- Verification: read every file listed; reproduced 3 defects with throwaway tests (created under `tests/_tmp_*` and deleted afterwards; scratch copy in session scratchpad). Checked Starlette 1.7 Range behaviour, FastAPI 0.141 body-parsing order, httpx/google-genai 2.25 exception hierarchy against installed packages.

## Test status (fact-check of "92 passing")
`pytest -q` now → **93 passed, 1 FAILED**: `tests/test_pipeline_end_to_end.py::test_pipeline_end_to_end` (file added 11:08, after the reports). It fails deterministically (3/3 runs) because of findings C2 + M6 below — the test is correct, the code is wrong.

## Overall assessment
The backend is tidy: repositories are thin, claims are atomic single `UPDATE … RETURNING`, the write lock has no re-entrancy (checked: `transaction()` bodies only use `conn.execute`, never `db.execute`), auth covers every `/api` route, stored paths are checked before serving, no XSS sinks with server text. But the pipeline has two ordering/stall bugs that break books in ordinary use, the worker loops die on the first unexpected exception, and the service worker breaks streaming audio for every chunk that isn't already cached. Three MVP acceptance criteria fail when you trace the code.

---

## Critical

### C1. Book stalls for good once its tail chunk has been synthesized (pages added later are never chunked)
- `app/repositories/chunk_repository.py:85-87`, `app/pipeline/chunker_worker.py:31,64-67`, `app/pipeline/worker.py` (docstring claims)
- Nothing ever sets `sealed=1` on a tail that TTS has claimed (grep: only `replace_tail` and `update_text` write `sealed`). Once the grace period passes (`tail_seal_grace_seconds=90`), TTS claims the unsealed tail and finishes it (`done`, `sealed=0`). The next page's tick then runs `DELETE … WHERE id=tail AND status='pending'`, gets rowcount 0, raises `TailBusyError`, and returns without `mark_chunked`. This repeats on every tick, forever.
- When it happens: the user pauses more than 90 s between pages, or uses "Thêm trang" on an existing book. Both are normal.
- Reproduced: after page 0 was synthesized and page 1 reached `ocr_done`, 5 ticks later page 1 still had `chunked=0` and the only chunk was the done tail. Nothing shows it: `book_state()` (`app/api/serializers.py:9-18`) reports `ready`, because unchunked `ocr_done` pages count as neither processing nor failed.
- Fix: in `_chunk_book`, if `tail.status in ('done','processing','waiting_quota','failed')`, don't re-split it. For `done`/`failed`/`waiting_quota`, `UPDATE chunks SET sealed=1 WHERE id=?` and start `carry=""` at `next_free_seq`. For `processing`, skip this tick. Or seal inside `claim_next_pending` when it claims an unsealed chunk (`SET status='processing', sealed=1`). Add a regression test. Also make `book_state` report `processing` while any `ocr_done` page has `chunked=0`.

### C2. Ordering invariant broken: a missing `seq` doesn't block the chunker, so late pages land out of order
- `app/pipeline/chunker_worker.py:35-55`, `web/js/upload-queue.js:72`, `web/js/views/capture-view.js` (`seq = nextSeq + items.length`)
- The loop only walks pages that already exist. If seq N hasn't been uploaded yet, N+1 is folded straight after N-1. When N arrives, it is appended after whatever is already in the tail.
- Real trigger: `UploadQueue._run` keeps uploading later items after one item hits 3 failed attempts (status `error`, "chạm để thử lại"). The user's later retry puts page N after N+1…N+k. Removing a queued thumbnail also leaves a permanent gap, which is harmless in the current code but would block forever under a naive "require contiguous seq" fix.
- Reproduced: the new e2e test (upload order 2,0,1,4,3) produced chunk text in order p0,p2,p1,p4,p3 (instrumented carries: `CARRY 2460 = p0+p2`, then `tail+p1`, then `tail+p4+p3`).
- Fix, pick one:
  - (a) Server assigns `seq` at upload (`MAX(seq)+1` inside the insert, keep `upload_id` idempotency), and the client queue stops at the first errored item until it is retried or discarded.
  - (b) The chunker requires `page.seq == last_chunked_seq + 1` and the client sends an explicit "discard seq N" (dead page).

  Either way, the plan's "không chunk khi còn trang trước đó chưa xong" has to cover pages that haven't been uploaded yet.

### C3. Service worker breaks online playback for every chunk not already downloaded
- `web/sw.js:86-94`
- `<audio>` sends `Range: bytes=0-`. `fetch(request)` forwards it, and Starlette returns **206** (verified: `bytes=0-` → 206 `bytes 0-999/1000`). `networkRes.ok` is true for 206, so `cache.put(request.url, 206)` runs. The Cache API spec requires `put` to reject 206 with a TypeError, so `handleChunkAudio` rejects, `respondWith` fails, and the audio element gets a network error. From the second page load on (once the SW controls the page), only books fetched through "Tải để nghe offline" (non-Range fetch, 200) will play. This breaks the core "vừa đọc vừa nghe" flow and phase-4 "Nghe liên tục 10 đoạn".
- Fix: on a cache miss, `return fetch(request)` as a pass-through and don't cache. Only `offline-audio-cache.js` populates the cache. If you want opportunistic caching, fetch `new Request(request.url)` without Range and put only `status===200`.

### C4. AC "bật chế độ máy bay → nghe lại được sách đã tải" fails: offline app goes to the login screen
- `web/js/app.js:42-45`, `web/js/views/reader-view.js:56,65-67`, `web/sw.js:104-113`
- Offline, `networkFirst` returns 503 JSON. `authApi.me()` throws, `authStore.user=null`, and the app routes to `#/auth`. Even with auth bypassed, the reader needs `GET /api/books/{id}` and `/chunks`, which aren't cached anywhere, so it shows "Không tải được sách". The cached MP3s can't be reached.
- Fix:
  - Cache the last `/api/me` response, and each downloaded book's detail + chunks JSON, in localStorage/IndexedDB (or a per-user SW cache, cleared on logout).
  - Treat `status 0/503 offline` from `me()` as "keep the cached user", not "logged out".
  - Have the reader fall back to the cached chunk list.

## High

### H1. Worker loops die silently on any unexpected exception
- `app/pipeline/worker.py:145-152` (`_ocr_loop`), `202-208` (`_chunk_loop`), `216-222` (`_tts_loop`), `295-301` (`_cleanup_loop`). Each catches only `CancelledError`.
- Concrete paths that escape:
  - Network errors inside google-genai are raw `httpx.ConnectError`/`ReadTimeout`. Their MRO is `…HTTPError → Exception`, not `OSError`/`TimeoutError`, so `app/pipeline/ocr_gemini.py:56` and `app/pipeline/tts_gemini.py:42` don't map them. A Wi-Fi blip on Railway's egress kills the loop.
  - `Path(page.image_path).read_bytes` raises `FileNotFoundError` (worker.py:167) if the image is missing, e.g. after the cleanup/retry race in L4.
  - `assert chunk.provider and chunk.voice` (worker.py:247) fails when the book is deleted between claim and the provider copy (`chunk_repository.py:138-140` returns a chunk whose `provider` is NULL).
  - Any `aiosqlite.OperationalError`, `lameenc` error, or `OSError` on a full disk.
- Impact: with the default concurrency 2, two blips stop OCR/TTS entirely until redeploy. The claimed row stays `ocr_processing`/`processing` with no log (`stop()` gathers with `return_exceptions=True`). If the chunk loop dies, every book stops.
- Fix: wrap each iteration in `try/except Exception: log.exception(...)`, mark the claimed row failed/requeued, back off, and continue. Map `httpx.HTTPError` (and genai `ClientError`/`ServerError`) in both Gemini providers. Replace the `assert` with a `mark_failed`/requeue. Consider an explicit `http_options` timeout on `genai.Client`, since the default may hang indefinitely.

### H2. Voice change or text edit mid-TTS can leave stale audio marked `done`, or delete the live file
- `app/repositories/chunk_repository.py:145-150` (`mark_done … WHERE status='processing'`), `app/repositories/book_repository.py:126-129`, `chunk_repository.py:45-51`, `app/pipeline/worker.py:276-278`
- `change_voice` and `update_text` reset a `processing` chunk to `pending`. Another TTS loop can re-claim it. Whichever synthesis finishes first wins `mark_done`, because there is no claim token. The loser unlinks its own `target_path`.
- Reproduced with 2 gated calls: final row `voice='Puck'` but `audio_path=…00000-cb4670c0.mp3`, which is the **Kore** hash (`content_hash(...,'Kore')[:8]=cb4670c0`, Puck=`74d5ff5f`). So the book mixes voices, violating D11 / the AC "không lẫn giọng". An edited chunk can end up done with the old text's audio. If both runs have the same hash (PATCH with identical text), the loser deletes the very file the winner's row points at, and the audio route returns 404.
- Fix: add a `claim_id` (or reuse `attempts`) set at claim time. `mark_done/mark_failed/mark_waiting_quota … WHERE id=? AND claim_id=?`. Never unlink a path equal to the row's current `audio_path`. Alternatively, have `change_voice`/`update_text` leave `processing` rows alone and flag `needs_regen=1`, which the worker checks at `mark_done`.

### H3. Continuous playback doesn't resume when a waiting chunk becomes ready
- `web/js/audio-playlist.js:75-76`, `55-58`
- `loadAt` for a chunk without audio does `removeAttribute('src'); el.src = ''`. Assigning `''` re-creates the attribute, and `HTMLMediaElement.src` reflects it as the resolved document URL (truthy). It also triggers a failed media load of the page URL. `setChunks` then checks `!this.active.src`, which is always false, so the auto-resume the plan promises ("player dừng ở đó và tự tiếp khi có audio") never fires. The same pattern appears at :151 and :195-196.
- Fix: only `removeAttribute('src'); el.load()`. Check `el.getAttribute('src')` or track `this._loadedSeq`, not `el.src`.

### H4. Pre-auth unbounded body parsing: DoS by anonymous clients
- `app/api/pages_routes.py:37` (`File(...)` param); FastAPI `routing.py:430` calls `await request.form()` **before** `solve_dependencies` (481), so `require_user` runs after the whole multipart body is spooled to disk.
- Starlette 1.7 `max_part_size` (1 MB) applies only to non-file fields, and file parts are unbounded. JSON routes (`request.body()`) are unbounded too. Anyone who knows the public `*.up.railway.app` URL can fill the container's temp disk or RAM without logging in. The 5 MB check at pages_routes.py:43 runs after all of that.
- Fix: add an ASGI middleware that rejects `Content-Length` over ~6 MB on `/api/books/*/pages` and over ~64 KB on other `/api` routes, and counts streamed bytes for chunked uploads. Optionally check the session cookie in the middleware before reading the body.

### H5. argon2 hashing runs on the event loop
- `app/auth/auth_routes.py:71,83,87` (`hash_password`, `verify_password`, and a dummy verify for unknown users)
- The default `PasswordHasher` (t=3, m=64 MiB) takes tens to hundreds of ms of CPU on a shared Railway vCPU, synchronously. Each login/register attempt, including rate-limited-but-distributed ones, freezes all API requests, audio range responses and worker loops for that time.
- Fix: `await asyncio.to_thread(verify_password, …)` / `to_thread(hash_password, …)`.

## Medium

- **M1. `tts_voice` is free text (≤80 chars) and never validated.** `app/api/books_routes.py:25,31`. It goes unescaped into the SSML attribute at `app/pipeline/tts_azure.py:22` (`name="{voice}"`), so an owner can inject SSML. An unknown Gemini voice makes every chunk `failed`. Fix: validate against `voices_routes.GEMINI_VOICES/AZURE_VOICES` (plus the env defaults) and 400 otherwise; `quoteattr` in SSML.
- **M2. Gemini 429 without a `Retry-After` header pauses TTS for a full hour.** `app/pipeline/tts_gemini.py:73-84`. Google's REST API usually reports the delay in the body (`error.details[].retryDelay`, available as `APIError.details`), not in a header. So per-minute 429s become 1 h pauses (worker.py:261). Fix: parse `details` for `google.rpc.RetryInfo.retryDelay`, and fall back to 60 s for RPM-type 429s and 1 h only for daily quota.
- **M3. Lock-screen next/previous not wired.** `web/js/views/reader-view.js:118-124` passes no `onNext/onPrev`, so the phase-4 SC "Nút tai nghe/màn hình khoá điều khiển được play/pause/next" is not met. Fix: pass `() => playlist._advance(1)` / `_advance(-1)` (expose public `next()/prev()`).
- **M4. Capture throws on browsers without `OffscreenCanvas`.** `web/js/camera-capture.js:83,89`: `canvas instanceof OffscreenCanvas` throws `ReferenceError` when the global is undefined (iOS Safari < 16.4, e.g. iPhone 7/iOS 15), so every capture fails there. Fix: `const hasOffscreen = typeof OffscreenCanvas !== 'undefined'` and branch on that.
- **M5. App-shell cache never updates.** `web/sw.js:4,115-124`. The shell is cache-first under a fixed `booksnap-shell-v1`, and `main.py` sets `no-cache`, but the SW never revalidates. Installed PWAs keep old JS until `sw.js` bytes change, so JS-only fixes (H3, M3, M4) won't reach users. Fix: derive the cache name from a build/version constant that gets bumped each deploy, or use stale-while-revalidate for the shell.
- **M6. Cross-page join glues words together.** `app/pipeline/chunker_worker.py:52`: `carry + "" + page.text` when `continues=1` gives "khi"+"sang" → "khisang" (seen in the e2e run as `tai.sang`). Vietnamese syllables are space-separated, so TTS mispronounces them. Fix: join with `" "` (strip a trailing hyphen if present).
- **M7. Chunk edit can be silently lost to a concurrent re-split.** `chunk_repository.py:45-51` vs `:85`. `update_text` leaves `status='pending'` and sets `sealed=1`. If the chunker already read that row as the tail, `DELETE … WHERE id=? AND status='pending'` still matches and deletes the user's edit. Fix: `… AND status='pending' AND sealed=0`, and raise `TailBusyError` otherwise.
- **M8. SW caches every played audio forever.** `web/sw.js:86-94`: once C3 is fixed with opportunistic caching, every played chunk and every old `?v=` version stays in `booksnap-audio-v1`, and `removeBookDownload` only removes current URLs. Fix: cache only via explicit download (see C3 fix), and delete stale `?v=` entries for the chunk id on download.
- **M9. Quota ETA not shown on the book status screen.** `web/js/components/progress-timeline.js:30` shows "Chờ quota — N đoạn" but ignores `chunks.next_not_before`. The AC wording "dự kiến tiếp tục lúc …" is only met per paragraph in the reader.

## Low
- L1. `web/sw.js:70-75`: suffix ranges `bytes=-N` are sliced as `0..N` (wrong bytes), and `start ≥ total` should return 416. Fix: handle `match[1]===''` as `start=total-N`.
- L2. `app/auth/session_service.py:45`: sliding expiry extends only the DB row. The cookie keeps its original `Max-Age`, so users are logged out after 180 days regardless. Fix: re-`set_cookie` on touch (needs `Response` in `require_user`).
- L3. `app/pipeline/worker.py:135-141`: one `_wake` Event is shared and `clear()`ed by all N loops, so a wake meant for OCR can be eaten by a TTS loop. The cost is up to `poll_seconds` of latency.
- L4. `app/pipeline/cleanup_worker.py:24-30`: if a user retries a failed page between `list_failed_with_expired_image` and `clear_image`, the page ends up `uploaded` with `image_path=NULL`. `clear_image` is unconditional. Fix: `… WHERE id=? AND status='failed'`.
- L5. `app/pipeline/worker.py:270`: when a book is deleted mid-TTS, `mkdir` recreates `library/{book_id}` and the empty directory leaks. Tail replacement after a voice change also orphans the old tail's `audio_path` file (`chunk_repository.py:85` deletes the row without unlinking). Interrupted `.tmp-*.mp3` files in library dirs are never swept (cleanup only scans `tmp/`).
- L6. `app/repositories/page_repository.py:50`: a FK failure when a book is deleted during upload is reported as 409 `page_seq_taken`.
- L7. `app/db.py:168-178`: reads on the shared connection during an open `BEGIN IMMEDIATE` see uncommitted rows (e.g. chunk list mid-`replace_tail`). Transient only.
- L8. `web/js/views/book-status-view.js:24,40`: `retryPage → load()` starts a second poll chain while the first timer is still pending, and unmount clears only the last one.
- L9. `app/api/export_routes.py:59`: a file unlinked mid-export (voice change) raises inside the generator and produces a truncated ZIP.
- L10. `web/js/playback-progress.js:29`: local-vs-server merge compares the client clock with the server clock, so a phone clock skewed by minutes can pick the stale copy. `track(seq, 0)` on a chunk without audio can overwrite a real offset with 0 after 15 s.
- L11. Rate-limit IP (`app/auth/rate_limiter.py:39`) trusts the last `X-Forwarded-For` entry. That is correct only if Railway's edge appends and nothing else sits in front. If the header is absent, every user shares the proxy IP's 10/min bucket.
- L12. Files over 200 lines: `app/pipeline/worker.py` (312), `web/js/views/reader-view.js` (310), `web/js/views/capture-view.js` (242), `tests/test_books_api.py` (252), `tests/test_worker_resume.py` (248). `worker.py` could move TTS processing into `tts_worker.py` like `chunker_worker`/`cleanup_worker`; the reader could split out the player-state hook.

## Security checklist (c)
- Auth on all `/api` except register/login/logout: **OK** (every route has `CurrentUser`; `/api/me` requires it; unknown `/api/*` → 404).
- Path traversal: **OK**. Audio and export serve only DB `audio_path` after `is_within(library_dir)`, and `book_id` for `rmtree` comes from a DB-verified row.
- Upload validation: magic-byte sniff + declared type + 5 MB: **OK**, except pre-auth body parsing (H4).
- Sessions: 32-byte token, only SHA-256 stored, HttpOnly/Secure/Lax, revoked on logout and CLI reset: **OK** (L2).
- Secrets: API keys go in headers (`x-goog-api-key`, `Ocp-Apim-Subscription-Key`), never in URLs or logs. No keys in the repo (`AIza…`/`sk-` grep clean; `.env` gitignored). **OK**.
- XSS: the only `dangerouslySetInnerHTML` is `web/js/icons.js:44`, built from static `PATHS` + code-supplied props. All server text goes through htm/Preact text nodes. **OK**.
- SW: `/api/*` is network-only apart from the audio cache, and the shell cache holds no user data. The audio cache survives logout (accepted in the plan). **OK**, apart from C3/M8.
- CSRF: SameSite=Lax blocks cross-site cookie-bearing POST/PATCH/PUT/DELETE, and every GET is side-effect free. Relies on `up.railway.app` being on the PSL (see questions).

## API contract (d)
Checked `api-client.js` and the views against `serializers.py` and the routes. They match: `{error:{code,message,field}}`, upload fields `image`/`seq`/`upload_id`, `audio_url` (null unless done), `pages.next_seq`, `chunks.{total,done,waiting_quota,failed,processing,next_not_before}`, progress `{chunk_seq,offset_ms,updated_at}`, voices `providers.{p}.voices`, `can_manage`, `page_list`. Auth field errors map to `username/display_name/password/invite_code`. One gap: an unhandled 500 returns a plain-text body; the client degrades to "Lỗi máy chủ (500)", which is acceptable.

## Deploy (f)
- `railway.json` `startCommand: uvicorn app.main:app …`: module path correct (`app/main.py:114 app = create_app()`). `${PORT:-8000}` only works if Railpack runs the command through a shell (unverified, see questions). The healthcheck `/health` returns 503 on Railway when no volume is attached (intentional, `storage_health.py`).
- `.python-version` = `3.12`: OK.
- requirements: every third-party import in `app/` + `scripts/` (fastapi, starlette via fastapi, pydantic via fastapi, pydantic_settings, aiosqlite, argon2, google.genai, httpx, lameenc, uvicorn, python-multipart) is listed. **Complete.**

## Acceptance criteria (a)

| AC | Verdict from code |
|---|---|
| No photos in gallery (Android/iOS) | Code OK (getUserMedia → canvas → Blob, no `<input capture>`); **device-unverifiable**. Broken on iOS < 16.4 (M4) |
| OCR ≥98% accuracy, audio < 5 min | **Unverifiable** (real keys/pages) |
| Continuous playback, highlight, tap to jump | Highlight/tap OK; continuous playback **broken** by C3 (online, not downloaded) and H3 (waiting chunk) |
| Reopen → correct position | OK (local 5 s + server 15 s/pause/hide; newer wins), L10 caveat |
| Airplane mode → downloaded book plays | **FAIL** (C4) |
| Redeploy keeps data; restart resumes jobs | Resume OK (`resume_processing`, tested); volume **deploy-unverifiable**. Jobs can still die mid-run (H1) |
| Quota → `waiting_quota`, ETA shown, auto-resume, no voice mix | waiting_quota/pause/requeue OK (tested); ETA in reader only (M9); voice mix **possible** (H2); 1 h over-pause (M2) |
| Export ZIP | OK (tested) |
| Invite code required; `/api/*` 401 | OK (tested) |
| 2 users, independent progress / continue list | OK (tested) |
| Non-owner 403 on delete/voice | OK (tested) |
| Phase 2: end-to-end 5 pages, ordering | **FAIL** (e2e test red: C2, M6); C1 stalls books |
| Phase 4: lock-screen next | **FAIL** (M3) |
| Phase 3/4/5 Lighthouse, AA contrast, Railway cost, iOS Range 206 | **Unverifiable** without devices/deploy |

## Plan follow-ups (for lead; plan files not edited)
Phases 1 and 5 (code parts) look complete. Phase 2 is not done: C1, C2, H1, H2 need fixing and the e2e test must pass. Phases 3/4 are not done: C3, C4, H3, M3, M4 need fixing. Device and deploy checks are still open.

## Unresolved questions
1. Does Railpack execute `deploy.startCommand` through a shell? If not, `${PORT:-8000}` is passed literally and uvicorn fails to bind. Safer: `sh -c "uvicorn app.main:app --host 0.0.0.0 --port $PORT …"`, or rely on `$PORT` only.
2. Does Railway's edge always append the client IP as the last `X-Forwarded-For` entry (L11)?
3. Is `up.railway.app` on the Public Suffix List? If not, other Railway apps are "same-site" and the Lax-only CSRF posture weakens. A custom domain avoids the question.
4. Product: when a page permanently fails or is discarded, should the book continue past it (dead page) automatically, or wait for an explicit user action? This decides the C2 fix shape.

---

## Re-review (2026-09-29, after fixes)

Mode: read-only. `pytest -q` → **99 passed**. I also ran the summary SQL against an in-memory copy of the schema to check gap results, the query plan and timing (scratchpad only). I inspected `data/booksnap.db` read-only.

### Verdict per item

| Item | Verdict | Evidence |
|---|---|---|
| C1 tail stall | **Fixed** | `chunk_repository.py:114` claim sets `sealed=1` plus the token, and copies provider/voice from `books` in the same UPDATE. `get_unsealed_tail` (:67) returns only `sealed=0 AND status='pending'`. `chunker_worker.py:244` uses `next_free_seq` when there is no tail. Invariant check: `sealed=0` implies `pending` (claim is the only way out of pending and it seals; resume/voice-change/retry keep sealed=1), so a `waiting_quota`/`failed`/`done` tail can no longer block. Regression test `test_tail_claimed_by_tts_is_sealed_and_later_pages_start_new_chunk`. |
| C2 ordering | **Fixed server-side; client only partly** | `chunker_worker.py:217-227`: contiguous from 0, breaks on a missing seq or a non-`ocr_done` page, and skips only `discarded`. `PageRepository.discard` runs in one `BEGIN IMMEDIATE`, and `UNIQUE(book_id,seq)` makes a discard-vs-upload race safe: whichever goes second gets 409 and nothing reorders. Gap SQL checked: `[0,1,3,4,7]`→2, `[2,3]`→min_seq path→0, `[0,1,2]`→None. Web calls `/api/books/{id}/pages/{seq}/discard` with `item.seq` / `p.seq` / the missing seq, which is the correct seq. Client-side gap regression: see **N2**. |
| C3 SW 206 | **Fixed** | `sw.js:88-100` passes cache misses straight through and never calls `cache.put`. `SHELL_CACHE` was bumped to v2. |
| C4 offline | **Partially** | Cached user is used on non-401 (`app.js:56-66`), the reader falls back to `readOfflineBook` (`reader-view.js:74-90`), and the library lists offline books. But offline library cards go to a dead end: see **N3**. |
| H1 loop death | **Partially** | `_run_forever` (`worker.py:135-145`) wraps the OCR/TTS/chunk loops. Per-item guards mark rows failed (:164-168, :250-254). `httpx.HTTPError` is mapped in both Gemini providers. `FileNotFoundError` is handled (:179). The `assert` was replaced (:259). **Still open:** `_cleanup_loop` (`worker.py:311-317`) catches only `CancelledError`, so one `OSError`/`PermissionError`/DB error in `cleanup_once` ends TTL expiry and orphan sweep silently for the life of the process. Residual: `genai.Client` has no `http_options.timeout` (SDK default `None`, `_api_client.py:257`), so a hung request pins one of the two TTS/OCR loops indefinitely. |
| H2 stale TTS | **Fixed (narrow residual race)** | `mark_done/_waiting_quota/_failed` require `claim_token=?` (:147-166), and a new token is set on every claim. The old file is unlinked only if it is unreferenced. Test `test_stale_tts_result_after_voice_change_is_discarded`. Residual (Low): `worker.py:293-294` does check-then-unlink across two awaits. If stale run A and live run B share a target path (PATCH with identical text, or a voice change to the same voice, both on first synthesis), B's `os.replace` can land between A's `is_audio_referenced` and A's `unlink`. B then marks done on a deleted file and the audio route returns 404. Fix: name files per claim (`…-{hash8}-{token8}.mp3`), or skip unlink when the row's current `claim_token` is non-null. |
| H3 playlist resume | **Fixed** | `_loaded[activeKey]` is tracked, and `loadAt` does `removeAttribute('src'); load()` (`audio-playlist.js:62,81-84`). Minor: `_loaded` is keyed by seq, not `audio_url`, so after a voice change the current chunk keeps the old voice until it advances (Low). |
| H4 body limit | **Fixed** | `request_size_limit.py`: Content-Length fast path plus a streamed byte count, raising an `HTTPException` subclass. Registered in `main.py:72` (limit = 5 MB + 256 KB for all routes, looser than suggested but bounded). Tests at `test_books_api.py:259,271`. |
| H5 argon2 | **Fixed** | `auth_routes.py:72,84,89` use `asyncio.to_thread`. |
| M6 join | **Fixed** | `chunker_worker.py:235` joins with a space. |
| railway.json | **Fixed (deploy-unverified)** | `/bin/sh -c "exec uvicorn … --port ${PORT:-8000} …"`. |

### NEW High

**N1. Schema change edited migration #1 in place, so existing DBs never get `chunks.claim_token` and TTS dies**
- Where: `app/db.py:78` (column added inside `MIGRATIONS[0]`); `_migrate` (:138-144) only runs `MIGRATIONS[user_version:]`.
- Evidence: the local `data/booksnap.db` is `user_version=1` and its chunks columns lack `claim_token`.
- Scenario: any environment created before this change, including a Railway volume if a preview was already deployed, skips the migration. Every `claim_next_pending` then raises `no such column: claim_token`. `_run_forever` logs and retries every poll, so TTS never runs and the logs fill up. It is not surfaced anywhere else.
- Fix: append `MIGRATIONS[1] = "ALTER TABLE chunks ADD COLUMN claim_token TEXT;"` and leave #1 frozen. If nothing has ever been deployed, deleting `data/booksnap.db` is an acceptable one-off, but the rule "never edit an applied migration" still applies.

**N2. Removing a queued (not yet uploaded) thumbnail now blocks the book**
- Where: `web/js/upload-queue.js:59-73`, `web/js/views/capture-view.js:113`.
- `remove()` discards server-side only for `error` items. A `queued` item is spliced out while later items keep their seq numbers. Example: items 0 (uploading), 1 (queued), 2 (queued); the user deletes blurry page 1; page 2 uploads as seq 2; the server has {0,2}. Under the new contiguous rule the book is blocked at 1 (state `failed`, "Trang 1 chưa được tải lên"), and it stays blocked until someone finds the status screen and taps "Bỏ qua".
- The next capture also computes `seq = nextSeq + items.length` (=2), which duplicates the live item 2. That duplicate is self-healed by the 409 → `reassignSeq` path, but it costs an extra round trip.
- The same gap appears when the best-effort `discard` in `remove()` fails (offline), because the error is swallowed and later items upload anyway.
- Retaking a bad page is a normal action, so this turns a routine edit into a stalled book.
- Fix: in `remove()`, for any item that has not reached the server (`queued`, or `error` without a server row), renumber the following non-done items `seq -= 1`. This is safe because the queue is sequential and stops at the first error, so nothing after the removed item is on the server. Compute the capture seq as `lastItem.seq + 1`. Keep `discard` only for ambiguous error items, and if that discard fails, don't resume `_run()`: keep blocking and show the error.

**N3. Offline, the library leads to a dead end, so the airplane-mode AC is still not met through the UI**
- Where: `web/js/views/library-view.js:26` (`href="#/book/{id}"`), `web/js/views/book-status-view.js:175-185,240-241`.
- Offline, `BookStatusView.load` fails and renders only the error banner, with no "Đọc / Nghe" link. The reader fallback only helps if the user lands directly on `#/read/{id}`, and the PWA start URL opens the library. "Continue listening" is empty offline (`setContinuing([])`).
- Fix: when `isOffline`, point cards at `#/read/{id}`, and/or have `BookStatusView` fall back to `readOfflineBook(bookId)` and render the read button.

### NEW Medium
- **N4. `POST /books/{id}/pages/{seq}/discard` has no bounds on `seq`.** `pages_routes.py:315-316` (no `ge=0`); `page_repository.py:91-92` accepts any `seq ≤ max+1`, including negatives. `seq=-1` inserts a discarded placeholder. `blocked_at_seq` (`serializers.py:14`, `if b.pages_min_seq:` is truthy for -1) then reports blocked at 0, so the book shows `failed` permanently (verified via SQL: min_seq=-1) and it cannot be undone through the API. Values ≥ 2^63 give sqlite `OverflowError` → 500. Any logged-in family member can do this. Fix: `seq: int = Path(ge=0, le=MAX_PAGE_SEQ)`, and use `b.pages_min_seq is not None and b.pages_min_seq > 0`.
- **N5. The summary SQL scans every page and chunk row on every call.** `book_repository.py:65-92`. The plan is `MATERIALIZE ps/pg/cs` with full SCANs even for `get_summary(book_id)`. The gap subquery adds two correlated index seeks per page row. It is correct (plan: `SEARCH q (book_id=? AND seq=?)`, `SEARCH r (book_id=?)`, where MAX alone takes 0.05 ms), and the cost is O(N log N) over all books. Measured 100 ms per detail call at 50k pages / 150k chunks, on the single shared connection, and the status view polls every 3 s. This is fine at family scale (~10 ms at 5k pages) but grows with the library. Fix: push `WHERE book_id=?` into the derived tables for `get_summary`, and replace the gap subquery with `LEAD(seq) OVER (PARTITION BY book_id ORDER BY seq)`.
- **N6. Discard has no ownership check.** Discard is irreversible ("không thể hoàn tác") but only calls `load_book`, while delete and voice change are owner-only. This may be intended (uploads and retries are open to everyone). Product decision, see questions.
- **N7. `removeOfflineBook` is never called.** Deleted books, and every user's offline entries, remain in localStorage. Offline, the library lists deleted books, and logout does not clear them (the `book` JSON carries the previous user's `progress`/`can_manage`). Low privacy impact in a family app.

### Remaining from first review (still open)
- M1 (voice not validated; SSML attribute unescaped at `tts_azure.py:22`)
- M2 (429 without header → 1 h pause)
- M5 (shell cache name is still a hand-bumped constant; v2 bumped this time)
- M7 (`replace_tail` DELETE lacks `AND sealed=0`)
- M8 residual (stale `?v=` audio entries never pruned; opportunistic caching removed)
- M9 (quota ETA not in the timeline)
- Low: L1, L2, L3, L4 (`clear_image` unconditional), L5, L6, L7, L8, L9, L10, L11, L12

Closed:
- M3 (`reader-view.js:154-155`)
- M4 (`camera-capture.js:84`)
- M6

### Status / Summary / Concerns
- **Status: DONE_WITH_CONCERNS**
- Summary: C1, C3, H2–H5 and M6 are correctly fixed. Server-side C2 is correct and race-safe, and the gap SQL is correct. H1 and C4 are partially fixed. Three new High issues: N1 (migration edited in place, so existing DBs break TTS), N2 (removing a queued thumbnail leaves a gap that blocks the book), N3 (offline library → dead end). One notable Medium: N4 (negative-seq discard permanently marks the book failed).
- Concerns: book stall paths re-checked. A `waiting_quota`/`failed`/`done` tail can't block. A failed or missing page blocks only until retried or discarded (by design). An expired failed page requires a manual discard (by design). The chunk loop re-reads every page of each blocked book on each poll, which is cheap. The remaining stall sources are client-created gaps (N2) and a hung Gemini call with no timeout (H1 residual).

### Unresolved questions
1. Has any Railway/preview volume been created with the old schema? This decides whether N1 needs a real migration or a DB reset.
2. Should discard be owner-only, like delete and voice change (N6)?
