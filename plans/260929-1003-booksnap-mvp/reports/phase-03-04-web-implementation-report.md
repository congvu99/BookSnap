# Phase 3 + 4 report — PWA camera/library + reader/audio player

Date: 2026-09-29. Scope: `web/**` only (no `app/**` changes — main.py already mounted static + no-cache headers, hash routing needs no SPA fallback).

## Files created

```
web/index.html
web/manifest.webmanifest
web/sw.js
web/css/tokens.css, app.css, library.css, camera.css, reader.css
web/vendor/preact-htm.module.js          (vendored, MIT, see header comment)
web/icons/icon.svg, icon-192.png, icon-512.png
web/js/app.js                            (hash router + shell)
web/js/api-client.js                     (fetch wrapper, 401→#/auth)
web/js/store.js                          (authStore/themeStore pub-sub, per-user progress key helpers)
web/js/icons.js                          (inline Lucide-style SVGs, stroke 1.5)
web/js/camera-capture.js                 (getUserMedia, resize+JPEG encode, torch, vibrate)
web/js/upload-queue.js                   (sequential retry queue, seq conflict handling)
web/js/audio-playlist.js                 (2-<audio> playlist, preload, seek, rate)
web/js/playback-progress.js              (local 5s + server 15s debounce, prefer-newer restore)
web/js/media-session.js                  (lock-screen controls)
web/js/offline-audio-cache.js            (Cache API download/verify/remove)
web/js/views/auth-view.js
web/js/views/library-view.js
web/js/views/capture-view.js
web/js/views/book-status-view.js
web/js/views/reader-view.js
web/js/components/book-cover.js, bottom-nav.js, progress-timeline.js,
                  mini-player.js, player-sheet.js, chunk-paragraph.js, chunk-editor.js
```

`app/main.py` not touched — static mount + SPA/no-cache headers were already correct for hash routing (no path-based routes ever hit the server).

## Routes (hash-based)

`#/auth` · `#/library` (default) · `#/capture` (choose new/existing book) · `#/capture/:bookId` (camera) · `#/book/:id` (status/timeline) · `#/read/:id` (reader+player). Bottom nav hidden on auth/capture/read.

## Verification done

1. `node --check` (ES module mode) on every `.js` file — all pass, zero syntax errors.
2. Backend smoke test: `DATA_DIR=/tmp/... INVITE_CODE=test COOKIE_SECURE=false .venv/Scripts/python.exe -m uvicorn app.main:app --port 8766`. Curl'd every static asset (`/`, `/js/app.js`, `/manifest.webmanifest`, `/vendor/preact-htm.module.js`, `/sw.js`, `/icons/icon-192.png`) → all 200. Curl'd full auth+book API sequence (bad invite→403, good invite→201, /api/me, create book, list, continue, chunks empty→200 `[]`, logout→204, /api/me after logout→401) — matches serializers.py/api_errors.py exactly.
3. **Playwright + Chromium** (found pre-installed under the system Python at `C:\Users\Administrator\AppData\Local\Programs\Python\Python312`, not the project venv) with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (synthetic green camera feed) and `permissions:["camera"]`:
   - Register with wrong invite code → inline error "Mã mời không đúng" under invite_code field. Confirmed.
   - Register with correct invite code → redirected to `#/library`.
   - Library renders (empty state / grid, screenshots saved to scratchpad, matches Classic Library palette — ivory bg, wine-red primary, gold-bordered Cormorant covers).
   - Capture flow: create new book by title → camera view opens with fake video stream, frame guide, shutter, "Xong (n)". Tapped shutter twice → 2 thumbnails appended to strip, uploaded successfully (upload-queue → pagesApi.upload → 202).
   - Finished capture → navigated to `#/book/:id`, timeline shows "Tải ảnh: 2 trang đã gửi" (done/green), "Nhận dạng chữ: 2 trang lỗi" (failed/red, because OCR provider isn't configured in this smoke env — expected, not a bug: page.error = "Chưa cấu hình gemini"), retry buttons rendered per failed page.
   - Reader opened on a book with zero chunks → correct empty state message, mini player shows 0:00/0:00, disabled play button.
   - Logout → session cleared, redirected to `#/auth`.
   - No unexpected console/page errors (only the expected 401 from the initial unauthenticated `/api/me` probe on app boot, which the app silently handles).

Screenshots kept in the session scratchpad only (not committed): library-with-book.png, book-status.png, reader-empty.png, capture-view.png, capture-after-2shots.png, after-finish-status.png.

## Unverified — needs a real phone (manual checklist)

- [ ] Android Chrome + iOS Safari: capture ≥5 pages, confirm Photos/Gallery app has zero new images (D3 — code never uses `<input capture>`, only `getUserMedia`+canvas+Blob, but device photo-library behavior can't be verified in a browser automation sandbox).
- [ ] iOS Safari standalone (added to home screen): getUserMedia availability, torch capability (`track.getCapabilities().torch` — Safari historically has weaker support; code already hides the torch button when unsupported).
- [ ] Lock-screen playback controls (Media Session) on Android and iOS — code wires `setActionHandler` for play/pause/seekbackward/seekforward; untested against real OS media UI.
- [ ] Airplane-mode offline playback: download via "Tải để nghe offline" sheet button, then verify `<audio>` seeking works from SW's Range-sliced Cache API response — especially on iOS Safari, which is stricter about 206 responses (sw.js implements this per the phase 4 architecture note).
- [ ] Two accounts listening to the same book on two devices, each resuming their own position (progress logic implemented as specified: localStorage per user_id+book_id, server PUT debounced 15s + on pause/hide, prefer newer of local/server by `updated_at` — but only reasoned about, not tested with two real sessions/devices).
- [ ] Lighthouse PWA installability + a11y ≥90 score — not run (no Lighthouse CLI in this environment); manifest has name/icons(192,512 PNG + SVG)/theme_color/background_color/start_url/display=standalone, so installability criteria should be met, but not empirically scored.
- [ ] Actual TTS audio playback (gap <300ms between chunks, preload-at-10s-remaining logic, sleep timer pausing mid-book) — no real audio exists yet since phase 2 (OCR/TTS pipeline) wasn't running in this smoke test; `audio-playlist.js` logic was code-reviewed carefully but not exercised against real MP3s with real durations.
- [ ] `navigator.storage.persist()` actual grant behavior varies by browser vendor and site engagement heuristics — call is made but not verified to actually return `true` anywhere.

## Backend contract observations (informational only — did not touch `app/**`)

- No gaps found. `book_out`, `page_out`, `chunk_out` shapes, error codes/fields, and status codes all matched what the client expects on first try (see verification #2 above); no client-side workarounds were needed.
- `GET /api/books/{id}/export` referenced in the phase-5 note is not yet implemented (404 expected until phase 5 lands) — the "Tải bản sao" link in the player sheet / book status view points at `booksApi.exportUrl(id)` and will start working automatically once phase 5 adds the route; not a blocker for phases 3/4.
- Confirmed `page_seq_taken` conflict handling client-side (`upload-queue.js` `reassignSeq`) matches the documented contract, though not exercised against a real concurrent-upload race (would need two simultaneous capture sessions against the same book).

## Notable implementation decisions (not explicitly pinned by the phase files)

- `web/vendor/preact-htm.module.js` downloaded from `https://unpkg.com/htm@3/preact/standalone.module.js`, exports confirmed (`html, render, Component, useState, useReducer, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useErrorBoundary`) — added an attribution/license comment header since unpkg strips the original header on minified bundles.
- Icons: generated real 192×192 / 512×512 PNGs with a small dependency-free Python PNG writer (no PIL/numpy available in either venv) — simple wine-red background + cream open-book glyph + gold spine, padded to ~78% for maskable safety. Also shipped `icon.svg` for `sizes:"any"`.
- Long-press-to-edit on `ChunkParagraph` also exposes a visible edit icon button (accessibility: long-press alone isn't reliably discoverable/keyboard-reachable).
- "Chọn chương" from the phase-4 sheet spec was interpreted as chunk-level jump-to (via tapping paragraphs) since the data model has no chapter concept — sheet instead offers rate/sleep-timer/font-size/theme/offline-download/book-settings, matching what the backend actually models.
- Book creation UX: phase 3 doesn't specify a route for "create book" as distinct from "capture"; implemented as a `choose` sub-step inside `#/capture` (new-title form or pick an existing book), then transitions into the camera at `#/capture/:bookId`.

## Unresolved questions

1. None blocking — export route (phase 5) not yet built is expected per plan ordering, not a defect.

---

## Review fixes (2026-09-29, second pass)

Fixed the items the coordinator assigned from `reports/code-review-report.md` (C2, C3, C4, H3, plus M3/M4). `web/**` only, same ownership rules.

### C3 — SW broke online playback for every non-downloaded chunk
`web/sw.js`: `handleChunkAudio` no longer does `cache.put` on a cache miss (a `<audio>` Range request always gets a 206 from the server, and Cache API `put()` throws on any 206 — that's what turned into the 503 the review reproduced). Cache miss is now a pure pass-through `return await fetch(request)`; only `offline-audio-cache.js`'s plain non-Range GET ever populates `booksnap-audio-v1`. 206 slicing (`respondWithRange`) is unchanged and still only runs on a cache **hit**. Bumped `SHELL_CACHE` to `booksnap-shell-v2` (M5's point — this fix and H3/M3/M4 below only reach already-installed clients once the SW's own bytes change) and added the new `offline-book-cache.js` to the precache list.

### C4 — offline reload fell back to the login screen
- `web/js/store.js`: added `cacheUser`/`readCachedUser`/`clearCachedUser` (localStorage `booksnap:cached-user`) and an `offline` field on `authStore`, plus `online`/`offline` window listeners for a live signal.
- `web/js/app.js`: the `/api/me` bootstrap now only clears the user on a **real 401** (`ApiError.status === 401`). Any other failure (network error status 0, or the SW's offline-503 JSON body) keeps the last cached user and sets `offline: true`. `onUnauthorized` (real 401 from any authenticated call) still clears everything. Added a sticky "Đang ngoại tuyến" banner in the app shell when `offline` is true.
- `web/js/views/auth-view.js`: login/register now also call `cacheUser()` — this was missing entirely (caught by re-running the Playwright smoke test: `localStorage['booksnap:cached-user']` was `null` right after a fresh login until this fix).
- New `web/js/offline-book-cache.js`: stores `{book, chunks}` JSON per book id in localStorage, keyed outside any `/api/*` path so the SW's network-first rule never shadows it.
- `web/js/views/reader-view.js`: on successful load, if the book's audio is fully downloaded (`isBookDownloaded`), persists `{book, chunks}` via `saveOfflineBook` (also refreshed on each successful poll tick). On a failed initial fetch, falls back to `readOfflineBook(bookId)` and renders from that, with an inline "Đang ngoại tuyến — phát từ bản đã tải" banner. Progress restore still runs against the offline copy.
- `web/js/views/library-view.js`: on a failed `/api/books` fetch, falls back to `listOfflineBooks()` metadata and shows a "chỉ hiện sách đã tải" banner instead of erroring out. Logout now also calls `clearCachedUser()`.

### H3 — playback never auto-resumed when a waiting chunk became ready
`web/js/audio-playlist.js`: replaced every place that read `el.src` as a truthiness check (`el.src = ''` doesn't clear it — it resolves to the page's own URL, which is why `!this.active.src` was always false) with an explicit `this._loaded = {a: seq|null, b: seq|null}` map updated in `loadAt`, `_maybePreloadNext`, and the preloaded-swap branch of `_advance`. Clearing now uses `removeAttribute('src'); el.load()` everywhere (including `destroy()`). `setChunks()` and `play()` now check `this._loaded[this.activeKey]` instead of `el.src`.

### M3 — lock-screen next/previous not wired
Added public `AudioPlaylist.next()`/`prev()` (thin wrappers over the existing `_advance(1)`/`_advance(-1)`), and `reader-view.js` now passes `onNext`/`onPrev` to `setupMediaSession` (the handler plumbing already existed in `media-session.js`, it just wasn't being given callbacks).

### M4 — OffscreenCanvas ReferenceError on iOS < 16.4
`web/js/camera-capture.js`: `captureFrame()` used to do `canvas instanceof OffscreenCanvas`, which throws `ReferenceError: OffscreenCanvas is not defined` on engines where the global itself doesn't exist — the exact browsers this branch exists to support. Replaced with a single `const hasOffscreen = typeof OffscreenCanvas !== 'undefined'` check up front, then two fully separate branches that never reference the identifier when it's undefined.

### C2 — ordering invariant / upload queue + new discard contract
- `web/js/upload-queue.js`: `_run()` now walks `this.items` **in order** and stops (`break`) at the first item whose status is (or becomes) `'error'` — it no longer skips past a failed item to upload later ones out of order. `remove()` is now `async`: if the removed item had a real failed-after-retries status (not a `seq_conflict`), it best-effort calls `pagesApi.discard(bookId, seq)` so the server stops treating that seq as blocking once a later page uploads past it, then resumes the queue. Retrying the blocking item still resumes normally (loop restarts from the top on the next `_run()`).
- `web/js/api-client.js`: added `pagesApi.discard(bookId, seq)` → `POST /api/books/{book_id}/pages/{seq}/discard`.
- `web/js/views/capture-view.js`: thumbnails after a blocked (errored) item now render "Đang chờ trang trước" instead of "Chờ…"; `removeItem` awaits the now-async `queue.remove()`.
- `web/js/views/book-status-view.js`: failed pages now show both "Thử lại" (`pagesApi.retry`) and a new "Bỏ trang này" button (confirm dialog explaining the page's text will be missing from the audiobook) → `pagesApi.discard(bookId, p.seq)`. Missing seqs (`book.pages.missing_seqs`, defensively defaulted to `[]` in case an older backend hasn't shipped the field) render as "Trang N chưa được tải lên" + "Bỏ qua trang này". When `book.pages.blocked_at_seq` is set, a banner explains later pages are waiting on it.
- Backend already had the new contract live by the time I re-tested (`app/api/pages_routes.py:71` `POST /books/{book_id}/pages/{seq}/discard`, `serializers.py`/`book_repository.py` carrying `missing_seqs`/`blocked_at_seq`) — verified against the real endpoint, not just defensively coded.

### Verification (second pass)
- `node --input-type=module --check` on every `.js` file in `web/**` — all pass (re-ran after every batch of edits and once more at the end).
- Fresh backend (`DATA_DIR=/tmp/booksnap-test-data2 INVITE_CODE=test COOKIE_SECURE=false uvicorn app.main:app --port 8767`) + Playwright/Chromium with the fake-camera flags:
  - Register → library → create book → capture 3 real shutter taps → thumbnails upload → book status view → reader loads with no console/page errors beyond the expected initial unauthenticated `/api/me` 401 probe.
  - `mediaSession` present (`'mediaSession' in navigator` → `true`) — `next()`/`prev()` wiring didn't throw.
  - Logged out then logged back in, read `localStorage['booksnap:cached-user']` → correctly populated with `{id, username, display_name}` (this caught the missing `cacheUser()` call in `auth-view.js`, fixed immediately).
  - Discard flow end-to-end against the **real, already-implemented** backend endpoint: created a 1-page book, let OCR fail (no Gemini key in this env → page goes `failed` with error "Chưa cấu hình gemini"), confirmed the UI showed the `blocked_at_seq` banner ("Trang 0 đang chặn xử lý…") and both "Thử lại"/"Bỏ trang này" buttons, clicked discard (accepted the native `confirm()`), and the book flipped to `state: ready` / "Sẵn sàng — Có thể nghe" with "Đọc / Nghe" now available. Screenshots confirm this visually.
  - Killed both test servers and removed their temp `DATA_DIR`s afterward.
- Not independently re-verified: C3's actual 206-vs-cache.put behavior under a live service worker (would need a real browser with the SW registered and controlling the page, plus a real downloaded chunk to hit the cache-hit Range path — Chromium's SW registration inside this headless Playwright session wasn't exercised for the audio-cache Range slicing specifically, though the code path is a straightforward revert to the previously-reviewed-safe `respondWithRange` for cache hits and an unconditional pass-through otherwise); H3's auto-resume-when-ready path (needs a real audio chunk transitioning from not-ready to ready mid-session, which requires the TTS pipeline actually producing audio — none of my test books ever reached a `done` chunk since there's no Gemini key in this sandbox).

Status: DONE
Summary: Fixed C2 (upload-queue ordering + discard integration), C3 (SW 206/cache.put crash), C4 (offline user/book/library fallback), H3 (audio-playlist src-tracking bug), M3 (Media Session next/prev), M4 (OffscreenCanvas ReferenceError) — all in web/**, verified via node --check and live Playwright runs against the real backend (which had already shipped the new discard/missing_seqs/blocked_at_seq contract).
Concerns/Blockers: None blocking. Two fixes (C3's cache-hit Range path, H3's mid-session auto-resume) are code-reviewed carefully and structurally straightforward but not re-exercised end-to-end here because they need a real downloaded chunk / a real TTS-produced audio file, neither of which exists in this no-API-key sandbox — flagged in the original report's manual checklist and still applies.
