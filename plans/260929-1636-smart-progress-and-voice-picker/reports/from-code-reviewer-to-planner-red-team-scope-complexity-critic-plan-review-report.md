# Red-team plan review: Scope & Complexity Critic (Contract Verifier)

Plan: `plans/260929-1636-smart-progress-and-voice-picker/` (plan.md + 8 phases). Date: 2026-09-29.
Context: family app, one Railway replica, a few users. User asked for: smarter progress UI after capture, library that updates itself, Charon as default voice, voice pick + preview when creating a book or adding pages, voice change removed from book settings (new content only), page-number notice per upload. User approved: seal-tail button, client-side voice labels.

## Contract inventory (grep-verified)

| Contract | Consumers (file:line) | Count |
|---|---|---|
| `book_out(b, user)` | `app/api/books_routes.py:73` (`_book_detail`), `:82` (`/me/continue`), `:87` (`/books`). No test calls it directly. | 3 |
| `BookPatchIn` | `app/api/books_routes.py:107` only | 1 |
| Voice PATCH from the web app | `web/js/views/reader-view.js:266` (`handleChangeVoice`) only | 1 |
| `PlayerSheet` voices/onChangeVoice props | `web/js/views/reader-view.js:397-410` only (`now-playing-panel.js:10` imports only `RATES`) | 1 |
| `voicesApi.list()` | `web/js/views/reader-view.js:134` only | 1 |
| `booksApi.create` | `web/js/views/capture-view.js:93` only | 1 |
| `Worker(...)` built in | `app/main.py:57`, `tests/test_pipeline_end_to_end.py:55`, `tests/test_worker_resume.py:44`, `tests/test_usage_quota.py:44`, `tests/test_tts_router.py:63-67` | 5 |
| `AppContext` built in | `app/main.py:49` (`AppContext.build`) only | 1 |
| Entry points into CaptureView with a `bookId` | `web/js/views/book-status-view.js:152` ("Thêm trang"), `capture-view.js:96`, `:105`; route at `web/js/app.js:114` (`key=${route.bookId \|\| 'new'}`) | 3 |

---

## Finding 1: Phase 3 builds a lot of infrastructure for about 10 preview calls in the app's lifetime
- **Severity:** High
- **Location:** Phase 3, sections "Requirements" (lock map, shared RpmLimiter, usage) and "Architecture" (lifespan refactor, 2 new AppContext fields, `rpm_limiter.py` split)
- **Flaw:** The plan's own risk section says "khoảng 10 giọng × 1 lần trong cả vòng đời app". To support that it changes the lifespan, adds 2 new `AppContext` fields, splits out `RpmLimiter`, adds a per-key `asyncio.Lock` map, and adds a concurrency test. The file split is written as "nếu gây vòng import", but the cycle is certain: `worker.py` already imports `AppContext`, so `app_context.py` cannot import `RpmLimiter` from `worker.py`. Worse, sharing the limiter hurts the UI. `RpmLimiter.throttle()` sleeps until a slot opens (up to 60s). While a book is being synthesized, the 2 TTS loops keep the 10-RPM window full, so a preview click can hang for tens of seconds behind the worker.
- **Failure scenario:** The user is creating book #2 while book #1 is still being voiced. They tap ▶ Charon and the chip spins for up to about 60s (sliding-window sleep) before any network call. It looks broken. Meanwhile the lifespan refactor touches `main.py` right on top of the uncommitted WIP.
- **Evidence:**
  - `app/pipeline/worker.py:41` `from app.app_context import AppContext` (the cycle is certain)
  - `app/pipeline/worker.py:66` `await asyncio.sleep(60.0 - (now - self._hits[0]))`
  - `app/pipeline/worker.py:103` `self.tts_rpm = tts_rpm_limiters or {...}` (the worker already builds its own limiters)
  - `app/main.py:56-64` providers are only built inside `if settings.worker_enabled`
  - `app/pipeline/tts_gemini.py:27` the client is created only if `api_key`, and `:31` raises `TtsError("Chưa cấu hình gemini", retryable=False)`. So a separate "configured" check is not needed: map that error to 409. Also, `quota_policies()` returns a list (`app/usage_quota.py:40`), so the plan's `quota_policies(settings)[..].configured` indexing does not work as written.
- **Suggested fix:** Drop the lifespan refactor, the AppContext fields, the limiter split, the shared RPM and the lock map. In `voices_routes.py`, build the provider on demand through a small factory that tests can override, e.g. `app.state.preview_tts_factory` or a FastAPI dependency: `GeminiTtsProvider(s.gemini_api_key, s.gemini_tts_model, s.gemini_tts_style)`. Keep the atomic tmp + `os.replace`, which already makes 2 overlapping requests safe (worst case: 2 synth calls, once in the app's life). Keep usage metering: it is needed because the account quota screen counts `gemini_tts` requests per Pacific day (`app/usage_quota.py:43`). Tests go from 9 to about 5 (401, 404, miss then hit, provider error → 5xx, usage row).

## Finding 2: Three tail fields plus a `book_out` signature change, when one bool and one int in the detail route are enough
- **Severity:** Medium
- **Location:** Phase 1, sections "Requirements" (lines 16-19) and "Architecture" (`book_out(b, user, grace_seconds)`)
- **Flaw:** The plan adds `tail_waiting`, `tail_ready_at` and `tail_wait_seconds`. The plan itself says the client counts down from `tail_wait_seconds` (to avoid clock skew), so `tail_ready_at` is dead weight. It still costs a docs entry (Phase 8), a test assertion, and the reason `book_out` needs `grace_seconds`. The only countdown consumer is the status view (a `_book_detail` response). The library needs only the bool ("Chờ thêm trang", Phase 7). `/me/continue` needs neither.
- **Failure scenario:** All 3 `book_out` callers change signature to pass settings. The pure serializer becomes time-dependent (`now`), so list responses and the `/me/continue` response get clock-dependent fields no client uses, and tests must freeze time. An implementer may also derive the countdown from `tail_ready_at` against the client clock, which brings back the skew bug the plan says it fixed.
- **Evidence:**
  - `app/api/serializers.py:36` `def book_out(b: BookSummary, user: User) -> dict:`
  - Callers: `app/api/books_routes.py:73` `out = book_out(summary, user)`, `:82`, `:87`
  - `app/api/books_routes.py:69-77` `_book_detail` already adds detail-only fields (`page_list`, `missing_seqs`)
  - Every page uploaded + OCR'd + chunked calls `books.touch` (`app/pipeline/chunker_worker.py:77`), so `updated_at + grace` really is the right anchor. Only one representation of it is needed.
- **Suggested fix:** `book_out` gains only `chunks.tail_waiting` (the bool needs no grace, so the signature is unchanged). `_book_detail` adds `chunks.tail_wait_seconds` from `ctx.settings.tail_seal_grace_seconds`. Delete `tail_ready_at` from the requirements, tests and docs.

## Finding 3: The main "add pages" path skips the voice picker, so the core requirement is not met there
- **Severity:** High
- **Location:** Phase 4, section "Requirements" → "Sách có sẵn: bấm tên sách → mở panel inline"
- **Flaw:** The picker for an existing book exists only inside the `choose` step, reached via the bottom-nav `#/capture`. The "Thêm trang" button on the book status view links to `#/capture/{id}`. That route mounts `CaptureView` with `bookId`, and a `bookId` goes straight to `step='camera'`. Phase 4 also removes the only other voice-change UI (player-sheet). So on the most natural path for adding pages there is no way to pick a voice, which breaks the user's explicit rule that voice changes only when adding content. There is a second trap: the choose step itself sets `#/capture/{id}` after the PATCH, and `app.js` keys the view by `bookId`, so it remounts. If the implementer "fixes" this by showing the panel whenever `bookId` is present, the user sees the panel twice.
- **Failure scenario:** The user opens book A (Kore) and taps "Thêm trang". The camera opens at once and new pages are voiced in Kore. The user has no UI anywhere to switch to Charon for the new pages.
- **Evidence:**
  - `web/js/views/book-status-view.js:152` `<a class="btn btn-secondary" href="#/capture/${bookId}">Thêm trang</a>`
  - `web/js/views/capture-view.js:12` `const [step, setStep] = useState(bookId ? 'camera' : 'choose');`
  - `web/js/views/capture-view.js:105` `window.location.hash = \`#/capture/${id}\`;`
  - `web/js/app.js:114` `<${CaptureView} bookId=${route.bookId} key=${route.bookId || 'new'} />`
- **Suggested fix:** Add a `?voice=1` query param or a separate route (`#/capture/{id}/voice`) that the "Thêm trang" button uses to show the voice panel first. Alternatively, put a small "Giọng: X · Đổi" row in the camera topbar that opens the picker, which covers every entry point with one component. Add a manual QA step for the "Thêm trang" path.

## Finding 4: Voice whitelist on create/PATCH, the new `app/tts_voices.py` and the PoC-script refactor are scope creep
- **Severity:** Medium
- **Location:** Phase 2, "Requirements" (validate whitelist, "Áp dụng cho cả create_book") and "Architecture" (new module); Phase 8, "PoC giọng" (make the script import it)
- **Flaw:** The user asked for none of this. The Phase 3 preview route sits in `voices_routes.py`, where the lists already are, so the preview's whitelist needs no new module. The new module is justified only by the unrequested create/PATCH validation. That validation also adds a new 422 contract, an old-data carve-out ("chỉ validate input mới"), and 4+ tests. The real motivation is an existing backlog item (SSML injection via the Azure voice attribute), which the plan does not cite and which has its own fix (quote the attribute).
- **Failure scenario:** The work lands as part of a UX feature. Someone later sets `AZURE_TTS_VOICE` to a voice that is not in `AZURE_VOICES`, and creating a book with that voice passed explicitly returns 422. `_with_default` only rescues the default of the provider being checked, which the plan hand-waves. The scope grows across 3 phases (2, 3, 8) and 4 files for a risk already tracked elsewhere.
- **Evidence:**
  - `app/api/voices_routes.py:7-8` `GEMINI_VOICES = [...]`, `AZURE_VOICES = [...]` (already next to where the preview route will live)
  - `docs/project-roadmap.md:80` `**M1:** Voice not validated (SSML injection via Azure) | Medium fix | 20 min | ... Use quoteattr for SSML.`
  - `app/pipeline/tts_azure.py:22` `f'<voice xml:lang="vi-VN" name="{voice}">{escaped}</voice>'`
  - `app/api/books_routes.py:28,35` `max_length=80` is the only guard today
- **Suggested fix:** Cut create/PATCH validation and `app/tts_voices.py` from this plan. Keep the preview whitelist local in `voices_routes.py`. If M1 is wanted, do it as its own 20-minute change (whitelist + `quoteattr`) that references the roadmap item. Also drop the new repository method in Phase 2: `set_voice_for_new_content` is a one-line `UPDATE books` and can be `change_voice(..., requeue=False)` in `app/repositories/book_repository.py:140`.

## Finding 5: The per-phase EMA ETA resets all the time, so it rarely shows a number
- **Severity:** High
- **Location:** Phase 6, sections "Requirements → ETA" and "Architecture → createRateEstimator"
- **Flaw:** OCR and TTS run at the same time: the worker starts OCR loops and TTS loops as parallel tasks. `phaseOf`/`statusLine` rank `pages.processing > 0` (ocr) above `tts`, and the estimator "Reset khi chuyển pha". While the user is still capturing, the phase flips ocr ↔ tts on every uploaded page, so the TTS estimator keeps being wiped. Books are also small: a chunk is about 1200 characters (~1.5 chunks per page, at most 30 pages per session). With `minSamples=2` and 2 TTS workers finishing in pairs, an ETA shows only near the end, and a page reload throws away all samples (the brainstorm already admits this). The result is an estimator factory (alpha, minSamples, reset, observe, remainingMs) plus about 4 tests for a line that is mostly hidden.
- **Failure scenario:** The user captures 6 pages. The status line alternates between "Đang nhận dạng chữ…" and "Đang chuyển giọng…", and the ETA never appears, or appears for about 10s before "Sẵn sàng". Engineering time is spent on the least visible part of the view.
- **Evidence:**
  - `app/pipeline/worker.py:117` `[asyncio.create_task(self._ocr_loop()) for _ in range(self.ocr_concurrency)]` plus the TTS loops in the same list
  - `app/pipeline/text_chunker.py:23` `TARGET_CHARS = 1200`
  - `web/js/upload-queue.js:13` `export const MAX_PAGES_PER_SESSION = 30;`
  - Priority order in Phase 6 "Dòng trạng thái": 3 = `pages.processing > 0`, 5 = `chunks.processing > 0`
- **Suggested fix:** Cut the ETA from this plan. The % bar, "đoạn x/y" and the tail countdown answer "what is the app doing". If an ETA must stay, use one estimator on `chunks.done`, never reset, no alpha: remaining × (elapsed / done). No factory and one test.

## Finding 6: Phase 6 shows the same progress in three places and adds a duplicate CTA
- **Severity:** Medium
- **Location:** Phase 6, sections "Timeline" (sub-bars, `percentByStep`), "Danh sách trang" (collapse >8), "CTA Nghe ngay", "Khi chuyển sang ready" (toast)
- **Flaw:** The timeline already prints `done/total` per step. The plan adds an overall % bar, then a thin sub-bar per step (a new `percentByStep` prop), so the same numbers appear 3 times. The existing "Đọc / Nghe" button already appears when `chunks.done > 0`. The plan adds a second "Nghe ngay" CTA under the same condition but keeps the old one ("nút cũ giữ nguyên"). A full page list with 5 status chips plus "Xem tất cả N trang" collapse is also new; the user's page-number request is about the camera upload moment (Phase 5). None of this was asked for.
- **Failure scenario:** The status screen has 2 progress bars + 4 sub-bars + 2 listen buttons + a toast + a page list. The 159-line view goes past the 200-LOC modularization threshold, and more JSX means more regression surface for retry/discard, which has no automated tests.
- **Evidence:**
  - `web/js/components/progress-timeline.js:21` `` `${pages.done}/${pages.total} trang xong` ``
  - `web/js/components/progress-timeline.js:32` `` `${chunks.done}/${chunks.total} đoạn xong` ``
  - `web/js/views/book-status-view.js:153` `${(book.state === 'ready' || book.chunks.done > 0) && html`<a class="btn btn-primary" href="#/read/${bookId}">Đọc / Nghe</a>`}`
- **Suggested fix:** Keep the overall % bar, the status line, the countdown + seal button, and the active-step pulse. Change the existing "Đọc / Nghe" link to `#/listen` and add the "{mm} phút" label, instead of adding a second CTA. Cut `percentByStep`, the page-list collapse and the ready toast (the ready state is already shown by the timeline and the status line). Page chips are optional. If kept, no collapse: a 30-page cap does not need it.

## Finding 7: Phase 5 turns "show the page number" into a toast-grouping system and a second toast component
- **Severity:** Medium
- **Location:** Phase 5, sections "Requirements" (800ms grouping, ranges, 2-line topbar, first-run hint, confirm listing page numbers, vibrate per toast) and "Architecture" (new `status-toast.js`, `formatPageList`)
- **Flaw:** The ask is "each photo = 1 page, say which page finished uploading". The plan adds: time-window grouping (timer, clear on unmount), range formatting ("4–6", "1–2, 4") with 6 test cases, a 2-line topbar, a first-run hint, per-page confirm text, and a new toast component, while explicitly keeping the existing `.reader-toast` (a parallel copy). It also vibrates on every upload toast, even though capture already vibrates on every shutter press.
- **Failure scenario:** On fast Wi-Fi, each shutter press gives 2 vibrations (capture, then upload done ~300ms later). The haptic becomes noise, and on Android the 2 vibrations can merge into one. Several timers per item add ways to leak or leave a stale toast, and the plan's own success criterion "Không có timer rò rỉ" exists only because of this design.
- **Evidence:**
  - `web/js/views/capture-view.js:118` `cam.vibrate();` (already after each capture)
  - `web/js/views/reader-view.js:417` `<div class="reader-toast" role="status" aria-live="polite" ...>` and `web/css/bookmarks.css:42` `.reader-toast {`: an existing live-region toast
- **Suggested fix:** Thumbnail badge "Trang N" + a single `aria-live` line that shows the latest message ("Đã tải trang N ✓", replaced by the next one, cleared after 2.5s) + "Đã tải x/y" in the topbar + error label on the thumbnail. No grouping, no `formatPageList`, no extra vibrate, no hint. Reuse or generalize `.reader-toast` rather than adding `status-toast.js`. Tests: `newlyDone` only.

## Finding 8: Phase 7 reuses the `.rec-progress` class, adds an unrequested animation, and polls for hours
- **Severity:** Medium
- **Location:** Phase 7, sections "Requirements" (thin bar, `rec--just-ready`, poll on `waiting_quota`) and "Architecture" (`<div class="rec-progress" role="progressbar">`, `prevStates` Map, `justReady` prop)
- **Flaw:** (a) `.rec-progress` is already the listening-progress bar on the same card. A book that was listened to and then got new pages is `processing` and also has `progress`, so it would render 2 elements with the same class and different meanings. (b) The "just-ready" animation needs a new keyframe (`vinyl.css` has only `disc-spin`), a `prevStates` ref Map, a new prop and a 1.2s timer. The disc already appears when the state turns `ready`. (c) `waiting_quota` can last until Pacific midnight, so the library polls every 5s for hours while visible, for a state that cannot change before `next_not_before`.
- **Failure scenario:** (a) A finished book has new pages added: its card shows 2 stacked bars with conflicting widths/styles, or the processing bar inherits listening-bar CSS. (c) An open library tab makes about 720 `GET /api/books` requests per hour that change nothing.
- **Evidence:**
  - `web/js/components/library-crate.js:44` `${book.progress && html`<div class="rec-progress"><span style=${{ width: `${progressPercent(book)}%` }}></span></div>`}`
  - `web/js/components/library-crate.js:38` `${book.state === 'ready' && html`<${VinylDisc} book=${book} />`}` (the disc already appears on ready)
  - `web/css/vinyl.css:45` `@keyframes disc-spin` (the only keyframe, so no slide animation exists)
  - `web/js/components/library-crate.js:14-15` processing and waiting_quota share one label today
- **Suggested fix:** Use a distinct class (`rec-build`) for the processing bar or reuse the label only. Cut `rec--just-ready`, `prevStates` and `justReady`. Poll only while some book is `processing`; show `waiting_quota` statically. Keep the reuse of `phaseOf` labels.

## Finding 9: The fetch → blob → objectURL Map for preview causes the iOS gesture problem the plan then works around, and its 503 mapping clashes with the service worker
- **Severity:** Medium
- **Location:** Phase 4, sections "Requirements → Preview" (blob + module Map, 503/409 mapping) and "Risk Assessment → iOS Safari"
- **Flaw:** The plan caches in 3 layers (server disk, HTTP `Cache-Control: private, max-age=86400`, and a module-level objectURL Map with revoke logic). The async `fetch().blob()` loses the user gesture on iOS, which leads to the pre-created `Audio` hack and a "Chạm lần nữa" fallback state. Separately, the service worker's `networkFirst` returns a JSON 503 with code `offline` for any failed `/api` fetch, and Phase 4 maps every 503 to "Hết lượt Gemini". Phase 8 claims this is fine but does not check the body code.
- **Failure scenario:** The user is offline in the capture flow and taps ▶. The service worker returns a synthetic 503 and the UI says "Hết lượt Gemini, thử lại sau", which is wrong. On iOS the first tap often does nothing, which adds a 5th chip state and needs device QA.
- **Evidence:**
  - `web/sw.js` `networkFirst`: `return new Response(JSON.stringify({ error: { code: 'offline', message: 'Không có kết nối mạng' } }), { status: 503, ...`
  - Phase 3 requirement `Cache-Control: private, max-age=86400` already gives browser caching
- **Suggested fix:** In the click handler, run `audio.src = voicesApi.previewUrl(p, v); audio.play()` synchronously. The gesture is kept, the browser HTTP cache handles the second play, and there is no Map, no revoke and no fallback state. Show one error ("Không nghe thử được") on `audio.onerror`. If specific messages are kept, branch on `error.code` (`tts_quota` / `provider_unavailable` / `offline`), not on the HTTP status.

## Finding 10: 8 phases, the voice PoC runs after the default has already changed, and the JS test harness has no runner
- **Severity:** Medium
- **Location:** plan.md "Phases" table and "TDD" header; Phase 8, "PoC giọng" and "Docs"
- **Flaw:** (a) The PoC that decides whether Charon is acceptable is in Phase 8, after Phase 1 has flipped the default and Phase 4 has written labels around it. If Charon reads Vietnamese badly, phases 1, 4 and 8 are reworked. The PoC script also lacks Charon/Orus, and Phase 3's preview endpoint already is a voice-listening tool (run it on localhost with a real key), so the separate PoC script plus its refactor is duplicate work. (b) `node --test` is added with no `package.json`, no `tests/web/` and no CI. The JS tests are a manual gate, yet Phase 8 writes the new convention into `code-standards.md`, `codebase-summary.md`, `design-guidelines.md`, the roadmap and the README (5 docs of churn). (c) Phases 5 and 7 are effort "S", and Phase 8 is mostly docs. 8 phases with a TDD ritual each (Tests Before / Tests New / Regression Gate) is heavy process for 1 replica and a few users.
- **Failure scenario:** Charon is rejected in Phase 8, so the default, `.env.example`, the README, the label order and the Railway env are all redone. Months later, no one runs `node --test` because nothing runs it, so the 3 `.test.mjs` files turn into tests that no longer protect anything.
- **Evidence:**
  - `scripts/voice_poc.py:32` `GEMINI_VOICES = ["Kore", "Aoede", "Leda", "Zephyr"]` (no Charon)
  - `app/config.py:26` `gemini_tts_voice: str = "Kore"`
  - `ls` of the repo root: no `package.json`, no `.github/workflows`; `ls tests/web` → "No such file or directory"
  - plan.md dependency note: "6 (cần 1 + StatusToast của 5), 7 (cần processing-progress.js + use-visible-polling.js của 6)"
- **Suggested fix:** Move the voice check first: before Phase 1, play Charon/Orus once via a 3-line REPL call or the existing script with the list edited locally, and get the user's OK. Merge into 4 phases: (A) backend: tail bool + wait seconds + seal-tail + `replace_tail` guard + default voice + PATCH `regenerate` + preview; (B) capture: picker + page notices; (C) status view + library poll; (D) env/SW bump/Railway + a short docs update (only `system-architecture.md` + README). Keep pure-JS tests only for `overallPercent`/`phaseOf` and `newlyDone`, and add one README line with the command. Do not touch code-standards or design-guidelines for this.

---

## Not attacked (verified OK or explicitly approved)
- Seal-tail endpoint + `replace_tail` `sealed=0` guard: the race is real. `app/repositories/chunk_repository.py:85` `DELETE FROM chunks WHERE id=? AND status='pending'` has no `sealed` guard, and the fix is one clause. Keep it.
- `PATCH regenerate=True` default: needed for old PWA clients still calling `reader-view.js:266`. Keep it.
- Usage metering in preview: needed so the account quota screen stays truthful (`app/usage_quota.py:43`). Keep it, and pass `book_id=None`; `provider_usage.book_id` has no FK (`app/db.py:117`).
- Client-side voice labels (approved).

## Unresolved questions
- Should the "Thêm trang" button (`book-status-view.js:152`) show the voice picker, or is the choose-step-only placement a deliberate trade-off the user accepted?
- Is an ETA actually wanted by the user, or was it introduced in the brainstorm? The user's ask was "biết app đang làm gì", which the status line + countdown already answer.
- Should voice validation (roadmap M1) be a separate ticket?

Status: DONE_WITH_CONCERNS
Summary: 10 findings (3 High, 7 Medium). Main issues: the overbuilt preview infrastructure (the shared limiter can stall previews up to about 60s), the triple tail fields and `book_out` signature change, the "Thêm trang" entry point that skips the picker, ETA/animation/toast-grouping gold plating, a `.rec-progress` class collision, and 8 phases with a JS test harness nothing runs.
