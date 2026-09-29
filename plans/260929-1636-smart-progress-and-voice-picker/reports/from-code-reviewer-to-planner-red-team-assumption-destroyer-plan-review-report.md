# Red-team plan review: Assumption Destroyer (Scope Auditor)

Plan: `plans/260929-1636-smart-progress-and-voice-picker/` (plan.md + phase-01..08). Every claim below was checked against the current working tree, uncommitted WIP included.

Checked and found OK (not reported as findings):
- `node --test "tests/web/**/*.test.mjs"`: Node v24.15.0 is installed. There is no `package.json` in `D:/project/BookSnap`, `D:/project` or `D:/`, so ESM syntax detection handles typeless `.js` files. Node's own `--test` glob handles the quoting on Windows.
  - One correction: detection is on by default only from Node 22.7, so "Node ≥22" should say "≥22.7".
- `tests/web/` sits outside `web/`, so `test_service_worker_assets.py` does not scan it (it only scans `WEB.rglob`).
- `booksApi.list()` → `book_out` already returns `tts_provider`, `tts_voice` and `can_manage` (serializers.py:45-47).
- `ProviderUsageRepository.record(service, outcome, chars, book_id: str | None)` accepts `book_id=None`. `provider_usage.book_id` is nullable (db.py:124).
- `book_out` has 3 call sites, all in books_routes.py (lines 73, 82, 87).
- Preview under `/api/` goes network-first in the service worker (sw.js:161-164), so the SW never caches it.

---

## Finding 1: `tail_waiting` stays true while other chunks are actively being synthesized, and after grace ends
- **Severity:** High
- **Location:** Phase 1, "Requirements"/"Architecture"; Phase 6, "Dòng trạng thái" + "ETA" + Tests (`tail_waiting thắng tts khi chunks.processing chỉ gồm tail`)
- **Flaw:** The planned rule is `tail_waiting = tail_pending > 0 and pages_processing == 0`.
  - It ignores sealed chunks that are pending or processing alongside the tail.
  - It ignores whether grace has already expired.
  - The claim picks chunks `ORDER BY c.seq`, so the tail (highest seq) is claimed last even when it is eligible. Until then it stays `pending, sealed=0`.
  - `chunks.processing` counts `pending + processing` together. The API only returns a bool, so the client cannot tell "only the tail is left" from "tail plus 20 sealed chunks". The Phase 6 test "tail_waiting thắng tts khi chunks.processing chỉ gồm tail" cannot be implemented from the planned response shape.
- **Failure scenario:** A user captures 10 pages. OCR finishes, the chunker writes 25 sealed chunks and 1 tail, and TTS starts working through the sealed chunks.
  - For the first 90s the screen shows "Đang chờ thêm trang… 1:29", while 2 TTS loops are actually running. ETA is hidden (the plan says not to show ETA while `tail_waiting`).
  - After that the screen shows "Sắp đọc đoạn cuối…" for the whole several-minute TTS run, with no ETA. This breaks acceptance criterion 7 and the success criterion "no vague processing message".
  - The "Xong rồi, đọc luôn" button is still visible even though pressing it does nothing useful.
- **Evidence:**
  - `app/repositories/book_repository.py:91`: `SUM(status IN ('pending', 'processing')) AS processing`
  - `app/repositories/chunk_repository.py:122-131`: `c.sealed = 1 OR (b.updated_at <= ? AND NOT EXISTS ...) ... ORDER BY c.seq LIMIT 1`
  - `phase-01...md:17`: "`tail_waiting` = tồn tại chunk `status='pending' AND sealed=0` **và** không có page `uploaded|ocr_processing`"
  - `phase-06...md:32`: "Không hiện khi `waiting_quota` hoặc `tail_waiting`"
- **Suggested fix:**
  - Expose a count, `chunks.tail_pending`, plus `chunks.active = processing - tail_pending`.
  - Define `tail_waiting = tail_pending > 0 and pages_processing == 0 and now < tail_ready_at`. After `tail_ready_at` the tail is just queued, not waiting.
  - In `phaseOf`, let `tts` win whenever `active > 0`, and show the countdown as a secondary line only.
  - Add a backend test: a sealed pending chunk plus an unsealed tail should give `chunks.active == 1`.
  - Side issue: seal-tail is owner-only (`ensure_book_owner`), but any user can upload pages (`app/api/pages_routes.py:43`, only `load_book`). A family member who captured the pages cannot press "Xong rồi, đọc luôn". Decide this on purpose.

## Finding 2: Preview shares the worker's RPM limiter but not its quota pause, so it can hang the request and drain the worker's budget
- **Severity:** High
- **Location:** Phase 3, "Requirements" (cache miss) + "Risk Assessment: Preview chiếm RPM của worker"
- **Flaw:**
  - `RpmLimiter.throttle()` blocks by sleeping for up to 60s. If the worker is using the full 10 RPM (the normal state while a book is processing), a preview HTTP request hangs inside `throttle()` while holding the per-key lock. The UI chip stays on "loading" and the fetch has no timeout.
  - The worker's quota pause lives in memory on the Worker (`_pause_until`), not on `AppContext`. After a 429, preview keeps calling Gemini, and a preview 429 never pauses the worker.
  - Failures are not cached. Each tap on a failing voice is a new provider call (metered as `quota`/`error`) and takes an RPM slot from the worker.
  - The "~10 voices × 1 lần trong cả vòng đời app" estimate only holds for successes.
- **Failure scenario:** Gemini TTS is at daily quota and the worker has paused `gemini` until tomorrow. A user opens capture and taps ▶ on 4 voices, several times each.
  - Each tap is a real 429 call and adds a `provider_usage` row.
  - Before quota runs out, the same taps can each wait up to 60s behind the worker and consume slots that book TTS needed.
- **Evidence:**
  - `app/pipeline/worker.py:65-72`: `await asyncio.sleep(60.0 - (now - self._hits[0]))`
  - `app/pipeline/worker.py:107`: `self._pause_until: dict[str, str] = {}  # provider -> ISO timestamp, in-memory only`
  - `app/pipeline/worker.py:289`: pause is only set inside `process_chunk`
  - `phase-03...md:23`: "Qua `RpmLimiter` **dùng chung với worker**"
  - `phase-03...md:69`: "khoảng 10 giọng × 1 lần trong cả vòng đời app, chấp nhận được"
- **Suggested fix:**
  - Add a non-blocking `try_acquire()` to the limiter. If the limiter is full, preview returns 503 `tts_busy` with `Retry-After` right away instead of sleeping.
  - Move the pause map to a process-lifetime object on `AppContext`, shared by worker and preview. Preview should return 503 immediately while the provider is paused, and a preview 429 should set the pause.
  - Add a short negative cache (e.g. 60s) per key after `quota`/`error`.
  - Optionally apply a per-user `RateLimiter` (the pattern at `app_context.py:65`).

## Finding 3: The circular import is certain, and a falsy-dict fallback silently breaks the "shared limiter" guarantee
- **Severity:** Medium
- **Location:** Phase 3, "Architecture" ("Nếu import từ `app_context` gây vòng import thì tách...") + Success Criteria "Worker và preview dùng chung instance provider + limiter"
- **Flaw:**
  - The circular import is not an "if". `worker.py` imports `AppContext` at module level, and `main.py` imports `app_context` before `worker`. Adding `from app.pipeline.worker import RpmLimiter` to `app_context.py` will fail on import.
  - `Worker` uses `tts_rpm_limiters or {...}`. If `ctx.tts_rpm` is the planned default `{}`, or is populated after the Worker is built, the worker quietly creates its own private limiters. The shared guarantee disappears with no error.
  - Every test builds `Worker(ctx, tts_providers={fakes})` without passing limiters (test_pipeline_end_to_end.py:52-55, test_worker_resume.py:48). No planned test can observe the "shared instance" success criterion.
- **Failure scenario:**
  - An implementer follows the "if" literally, adds the import, and hits `ImportError: cannot import name 'AppContext' from partially initialized module`.
  - Or a later refactor reorders the lifespan so `Worker(...)` runs before `ctx.tts_rpm` is filled. Production then has 2 independent 10-RPM limiters (effectively 20 RPM), which causes 429s. Tests stay green.
- **Evidence:**
  - `app/pipeline/worker.py:42`: `from app.app_context import AppContext`
  - `app/pipeline/worker.py:103`: `self.tts_rpm = tts_rpm_limiters or {name: RpmLimiter(_default_rpm(s, name)) for name in tts_providers}`
  - `app/app_context.py:12-20`: repository imports only
  - `phase-03...md:36`: "(default rỗng)"
- **Suggested fix:**
  - Always move `RpmLimiter` to `app/pipeline/rpm_limiter.py`.
  - Change the fallback in `Worker.__init__` to `if tts_rpm_limiters is None`.
  - Extract a `build_tts_services(settings) -> (providers, limiters)` factory that the lifespan calls once.
  - Add a lifespan test (e.g. `worker_enabled=True`, `worker_poll_seconds` large) asserting `ctx.worker.tts_rpm is ctx.tts_rpm` and `ctx.worker.router.providers is ctx.tts_providers`.

## Finding 4: The module-level lock map in `app/voice_preview.py` outlives each app and event loop, and the style-change test proves nothing
- **Severity:** Medium
- **Location:** Phase 3, "Requirements" ("Lock theo key (`asyncio.Lock` trong dict, chỉ 1 process)") + "Architecture" (service `app/voice_preview.py` "Chứa lock map") + Tests ("Đổi `settings.gemini_tts_style` → cache miss mới")
- **Flaw:**
  - A module-level `dict[str, asyncio.Lock]` lives for the whole process. Every app and context in the process shares it, including every test app.
  - pytest-asyncio uses a new event loop for each test function. An `asyncio.Lock` binds to a loop the first time it is contended. The cache key is identical across tests (same provider, voice, style and model defaults, same text), so the same lock object is reused.
  - Any second contended use in a different test raises `RuntimeError: ... is bound to a different event loop`.
  - Separately, the cache key is built from `settings.gemini_tts_style`/`model`, but `GeminiTtsProvider` captures style and model once at construction. Changing settings at runtime gives a new key while the provider still synthesizes the old style. The planned test passes with a fake and proves nothing about real behavior.
- **Failure scenario:**
  - The concurrency test (`asyncio.gather`, cold cache) binds the lock to loop A. A later test that also contends the same key (e.g. a retry or quota concurrency test someone adds) fails on loop B with a 500 or RuntimeError.
  - In production, anyone relying on the style-change test gets cache files whose key does not match their audio.
- **Evidence:**
  - `pytest.ini`: `asyncio_mode = auto`, `asyncio_default_fixture_loop_scope = function`
  - `app/pipeline/tts_gemini.py:23-26`: `self._model = model; self._style_prompt = style_prompt`
  - `app/app_context.py:1`: `"""Process-wide services, built once in the lifespan and stored on app.state.ctx."""` (the existing home for per-app state)
- **Suggested fix:**
  - Put the lock map on a `VoicePreviewService` instance built in the lifespan and stored on `AppContext`, so it has app lifetime rather than module lifetime.
  - Derive the cache identity from the provider instance, e.g. a `cache_identity()` method returning `(model, style)` for Gemini and `""` for Azure.
  - Rewrite the style test to rebuild the provider with a different style.

## Finding 5: The "configured" pre-check collides with fake injection, and the picker offers providers that can never synthesize
- **Severity:** Medium
- **Location:** Phase 3, "Architecture" ("Nhận diện 'chưa cấu hình': dùng `quota_policies(settings)[..].configured` hoặc kiểm tra key rỗng") + Tests; Phase 2, "Validate voice theo whitelist"; Phase 4, `orderVoices` ("cả 2 provider đều có mặt")
- **Flaw:**
  - The test settings leave `gemini_api_key=""`. Both proposed detection methods read settings, so they return 409 before reaching the injected `FakeTts`.
  - That means the "200 + fake gọi 1 lần", "cache hit", "concurrency", "quota → 503" and "usage row" tests all get 409 unless each test also sets a fake key. The plan does not mention this.
  - Once a test sets the key, the "Provider chưa cấu hình → 409" test needs a separate setup. The detection is tied to settings instead of the provider actually used.
  - The whitelist planned for create/patch checks voice names only, not whether the provider is configured. `/api/voices` lists Azure even when there is no Azure key.
  - The whitelist error is planned as `422 unknown_voice`, but every other domain validation in this API returns 400 (`title_invalid`), and the validation handler maps to 400.
- **Failure scenario:** On production with no Azure key, a user picks "Nam · Azure" at book creation.
  - Preview returns 409, but creation succeeds. Every chunk then fails with "Chưa cấu hình azure", or never gets claimed if the provider is absent from the router.
  - The book is stuck in `failed` state.
- **Evidence:**
  - `tests/conftest.py:19`: `Settings(_env_file=None, ... worker_enabled=False)` (no key)
  - `app/config.py:21`: `gemini_api_key: str = ""`
  - `app/usage_quota.py:41`: `gemini = bool(settings.gemini_api_key)`
  - `app/api/voices_routes.py:15-24`: always returns both providers
  - `app/pipeline/tts_azure.py:122-123`: `raise TtsError("Chưa cấu hình azure", retryable=False)`
  - `app/api/books_routes.py:46`: `ApiError(400, "title_invalid", ...)`
  - `app/api_errors.py:37`: validation → 400
- **Suggested fix:**
  - Give each provider instance a `configured: bool` attribute; fakes set `True`.
  - Add an additive `configured` field per provider to `/api/voices`.
  - Reject create/patch for an unconfigured provider (409 `provider_unavailable`), and have the picker disable those chips.
  - Use 400 `unknown_voice` to match the existing contract.

## Finding 6: Client preview design contradicts itself (revoke vs module cache), the iOS mitigation does not unlock audio, and errors are mis-mapped
- **Severity:** Medium
- **Location:** Phase 4, "Requirements" (VoicePicker + preview) + "Risk Assessment: iOS Safari"
- **Flaw:**
  - "Unmount thì dừng phát và revoke URL" conflicts with "Cache objectURL trong `Map` cấp module, sống hết phiên trang". After an unmount (choose → existing-book panel → back, or new-book form ↔ panel), the Map hands out revoked `blob:` URLs, so the success criterion "lần 2 phát ngay" fails with "Không nghe thử được".
  - On iOS, `new Audio()` inside the gesture does not unlock playback. Only a synchronous `play()` call inside the gesture does. The first preview is always a cold miss taking 5–15s, so on iOS it will always need a second tap.
  - A raw `fetch` bypasses `apiFetch`'s 401 handling.
  - The service worker turns offline into a 503 JSON response, which the planned mapping shows as "Hết lượt Gemini", including for Azure voices.
- **Failure scenario:**
  - An iPhone user taps ▶ on Charon, waits 10s, and hears nothing (play() is blocked).
  - Or: they go offline for a moment, tap, and see "Hết lượt Gemini".
  - Or: they come back to the picker, tap a voice they already heard, and get an error because the URL was revoked.
- **Evidence:**
  - `phase-04...md:19-20`: "Unmount thì dừng phát và revoke URL." + "Cache objectURL trong `Map` cấp module, sống hết phiên trang."
  - `phase-04...md:69`: "tạo `Audio` trước trong click, fetch xong thì gán `src` rồi gọi `play()`"
  - `web/js/api-client.js:43-45`: 401 → `UNAUTHORIZED_EVENT`
  - `web/sw.js:131-139`: offline → `status: 503`, `code: 'offline'`
- **Suggested fix:** Drop blobs and objectURLs. In the click handler, run `audio.src = voicesApi.previewUrl(p, v); audio.play()` synchronously.
  - A media request to a same-origin URL sends the session cookie.
  - The server's `Cache-Control: private, max-age=86400` gives the fast second play.
  - Handle errors from the `error` event with a HEAD/JSON follow-up via `apiFetch`, mapping by `error.code` (`tts_quota`, `provider_unavailable`, `offline`), not by status.

## Finding 7: A voice-change entry point is missing, and the read-only voice line is wrong for mixed-voice books
- **Severity:** Medium
- **Location:** Phase 4, "Sách có sẵn" + "Player-sheet"
- **Flaw:**
  - The new voice panel only intercepts clicks in the `choose` list. The main "Thêm trang" button on the status screen links to `#/capture/{id}`. The router remounts CaptureView with `bookId`, so `step` starts at `'camera'` and skips the panel.
  - Player-sheet voice switching is removed. The only way left to change a voice is bottom nav → capture → pick from the list, which D7 did not intend.
  - The player-sheet line "Giọng đọc: {nhãn} ({tên})" is built from `book.tts_voice`. After a `regenerate=false` change, earlier chunks keep the old voice (the claim copies the voice per chunk). The label is wrong for every earlier chunk.
- **Failure scenario:** A user finishes a Kore book, taps "Thêm trang" on the status screen to add chapter 2 with Charon, and lands in the camera without a voice choice.
  - Or they change the voice via the list, then listen to chapter 1: the sheet says "Charon", but they hear Kore.
- **Evidence:**
  - `web/js/views/book-status-view.js:152`: `href="#/capture/${bookId}">Thêm trang`
  - `web/js/app.js:114`: `<${CaptureView} bookId=${route.bookId} key=${route.bookId || 'new'} />`
  - `web/js/views/capture-view.js:12`: `useState(bookId ? 'camera' : 'choose')`
  - `app/repositories/chunk_repository.py:115-116`: voice copied from the book at claim
  - `app/api/serializers.py:87`: `"voice": c.voice` is already exposed per chunk
- **Suggested fix:**
  - When CaptureView mounts with a `bookId` coming from "Thêm trang", open the existing-book panel first. Keep a `?go=camera` bypass only for the path after the PATCH.
  - In player-sheet, show the current chunk's `voice`, and mark books that have more than one distinct chunk voice.

## Finding 8: Phase 7's claim "chỉ sách ready mới có tiến độ nghe" is false, and `.rec-progress` is already taken
- **Severity:** Medium
- **Location:** Phase 7, "Requirements" ("**Không** poll `continueListening`...") + "Architecture" (`<div class="rec-progress" role="progressbar">`)
- **Flaw:**
  - `list_in_progress_for_user` has no state filter. Phase 6 adds a "Nghe ngay" CTA for processing books (`chunks.done ≥ 1`), and the reader already plays them today. So processing books do get progress rows and appear in the hero card.
  - The hero card is fed only by the initial `continueListening()` call, so it goes stale.
  - The class `rec-progress` is already the listening-progress bar in `library-crate.js`. A processing book that has listening progress would render two bars with the same class, CSS and position, with different meanings.
- **Failure scenario:** A user listens to the first ready chunks of a book still processing, then goes back to the library.
  - The hero card keeps showing "Đang ép đĩa 3/20" forever while the crate list updates underneath.
  - The crate shows two identical thin bars, one for build progress and one for listen progress.
- **Evidence:**
  - `app/repositories/book_repository.py:130-135`: `WHERE pr.user_id IS NOT NULL ORDER BY pr.updated_at DESC` (no state filter)
  - `web/js/views/library-view.js:51`: `Promise.all([booksApi.list(), booksApi.continueListening()])`
  - `web/js/views/library-view.js:87`: `const hero = ... continuing[0]`
  - `web/js/components/library-crate.js:44`: `<div class="rec-progress"><span style=${{ width: `${progressPercent(book)}%` }}>`
- **Suggested fix:**
  - Refresh the hero from the polled `list` (match by id), or poll both endpoints.
  - Use a distinct class and element, e.g. `rec-build` with `role="progressbar"` and an `aria-label` that says it is build progress.

## Finding 9: The ETA estimator resets on phase flips, so ETA never appears during capture
- **Severity:** Medium
- **Location:** Phase 6, "ETA" ("Tính riêng cho pha OCR (pages) và pha TTS (chunks). Reset khi chuyển pha.") + `phaseOf` priority (`pages.processing > 0` beats tts)
- **Flaw:**
  - The worker runs the OCR, TTS and chunk loops at the same time. While the user is still uploading, `pages.processing` flips 0↔>0 on every page (OCR takes about 3–5s per page), so `phaseOf` alternates ocr/tts/ocr.
  - Resetting on every flip wipes both estimators before `minSamples = 2` is ever reached.
  - The estimators are per unit (pages vs chunks), so phase is the wrong reset trigger.
- **Failure scenario:** A user captures 12 pages at a normal pace. For the whole session the screen alternates between "Đang nhận dạng chữ trang x/y" and "Đang chuyển giọng", with no ETA at any point. This is the main scenario the feature was built for.
- **Evidence:**
  - `app/pipeline/worker.py:116-119`: OCR, TTS and chunk tasks created concurrently
  - `phase-06...md:25`: "`pages.processing > 0`: Đang nhận dạng chữ..."
  - `phase-06...md:30`: "Reset khi chuyển pha."
- **Suggested fix:**
  - Keep two long-lived estimators, keyed by unit (pages, chunks).
  - Reset one only when its `done` goes down (a regenerate) or its `total` shrinks.
  - Pick which ETA to show from the phase, but never clear samples on a phase flip.
  - Add a test: alternating phase flips must not drop samples.

## Finding 10: The default-voice decision is validated only in the last phase; the PoC script has never produced Charon, and the global style change alters old books
- **Severity:** Medium
- **Location:** Phase 8, "PoC giọng (trước khi merge)"; Phase 1, "`gemini_tts_voice = "Charon"`, `gemini_tts_style = ...`"; Acceptance criterion 1 ("Sách cũ giữ `Kore`")
- **Flaw:**
  - `scripts/voice_poc.py` currently synthesizes only Kore, Aoede, Leda and Zephyr (all female). D2 (Charon) was chosen without ever hearing it on Vietnamese.
  - The PoC runs in Phase 8, after Phase 1 tests hardcode `"Charon"`, Phase 4 labels say "Nam · trầm", and preview cache keys depend on the style. If Charon is rejected, phases 1, 4 and 8 all need rework.
  - The script calls `get_settings()`, so a local `.env` holding the old `GEMINI_TTS_STYLE` makes the PoC evaluate the wrong prompt.
  - The new style is global and says "giọng trầm". It applies to every future Kore chunk of existing books, since the style is sent on every synth. `content_hash` excludes style, so no chunk is marked as changed.
  - Existing female-voice books that get new pages will therefore change timbre mid-book. This contradicts D3 / acceptance criterion 1 "Sách cũ giữ nguyên" in practice, even though `tts_voice` stays `Kore`.
- **Failure scenario:** Everything ships, then the user runs the PoC and finds Charon mispronounces Vietnamese tones. Default, labels, tests, docs and the Railway env all have to be redone.
  - Or: grandma's Kore book gets chapter 3 read "deep, low", and it sounds like a different narrator.
- **Evidence:**
  - `scripts/voice_poc.py:33`: `GEMINI_VOICES = ["Kore", "Aoede", "Leda", "Zephyr"]`
  - `scripts/voice_poc.py:60`: `GeminiTtsProvider(settings.gemini_api_key, settings.gemini_tts_model, settings.gemini_tts_style)`
  - `app/pipeline/tts_gemini.py:35`: `contents=f"{self._style_prompt}\n{text}"`
  - `app/pipeline/tts_router.py:22-25`: `payload = f"{text}\x00{provider}\x00{voice}"` (no style)
  - `app/config.py:27-28`: current `Kore` / "giọng kể chuyện ấm áp"
- **Suggested fix:**
  - Move the PoC to a Phase 0 gate before Phase 1. Import the voice list from `app/tts_voices.py` (or a CLI arg).
  - Run old style × new style for Charon, Orus and Kore, and pass the style explicitly rather than via `.env`.
  - Either keep the style truly neutral (no "trầm"), or make style per-voice or per-book, so existing books keep their original prompt.

---

## Unresolved questions
- Should seal-tail be allowed for any logged-in user who can upload pages (pages routes have no owner check), or stay owner-only on purpose?
- Should Azure be hidden entirely when `AZURE_SPEECH_KEY` is empty, or shown as disabled?
- Phase 6 `statusLine` formats "HH:MM giờ địa phương". Node tests will depend on the machine's timezone unless the formatter or timezone is injected. Is that intended?
- Phase 6 says to replace the `#/read` link "ở chỗ này" but also keep the old "Đọc / Nghe" button. Those are the same element (book-status-view.js:153). Which one stays?

Status: DONE_WITH_CONCERNS
Summary: 10 findings (2 High, 8 Medium). The two High ones are the `tail_waiting` meaning (stays true while other chunks are synthesizing and after grace ends) and preview sharing the RPM limiter without the worker's quota pause.
