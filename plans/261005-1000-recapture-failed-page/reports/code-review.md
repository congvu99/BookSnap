# Code Review: recapture failed page

## Scope
- Files: app/api/pages_routes.py, app/repositories/page_repository.py, web/js/image-downscale.js (new), web/js/camera-capture.js, web/js/api-client.js, web/js/components/recapture-page-sheet.js (new), web/js/views/book-status-view.js, web/sw.js, web/index.html, web/js/app-version.js, tests/test_page_recapture.py (new), tests/web/image-downscale.test.mjs (new)
- Focus: uncommitted diff. Suites not re-run (caller reports pytest 280 / node 135 green).

## Overall
Backend core is right: the swap runs in a `BEGIN IMMEDIATE` transaction under `_write_lock` and is gated on `status='failed'`. The new file gets a fresh `new_id()` name. The old file is deleted only after commit, and the new file is deleted on 409. The `upload_page` refactor behaves the same as before. Its validation order, 413/415 codes and file naming are all unchanged. I found no blockers. There is one real race with cleanup_worker (inherited from retry, but recapture makes it worse) and one keyboard a11y gap in the sheet.

## Critical
None.

## High
None.

## Medium

### M1. Race between cleanup expiry and recapture can wipe the new image path
- `app/pipeline/cleanup_worker.py:33-37` together with `app/repositories/page_repository.py:185-188`
- `_expire_failed_images` takes a snapshot of failed pages, then awaits `to_thread(unlink)` for each one, then calls `clear_image(page.id)`. `clear_image` is an UPDATE with no status or path condition.
- Failure sequence: cleanup lists page P (failed, old image is past TTL). The user recaptures P, which commits `uploaded` with a new image_path. Cleanup then runs `clear_image(P)` and sets image_path and image_mime to NULL on the new row.
- Result: the worker claims P and `process_page` marks it failed with "Thiếu ảnh gốc" (`worker.py:174`). The new file is orphaned until the 1h orphan sweep. The user sees the page fail again right after a successful recapture.
- The window is small, but this is exactly when users recapture: old pages whose image has expired or is about to.
- `reset_for_retry` already has this race. The new endpoint adds a second writer and also orphans a file.
- Fix: make the clear conditional, e.g. `UPDATE pages SET image_path=NULL, image_mime=NULL, updated_at=? WHERE id=? AND status='failed' AND image_path=?`. Pass the snapshot path in. Optionally unlink only when the update changed a row (or unlink after the update).

### M2. Recapture sheet cannot be operated with a keyboard
- `web/js/components/recapture-page-sheet.js:38-45`
- Both actions are `<label>` elements wrapping `<input hidden>`. The `hidden` attribute means display:none, so neither input can be tabbed to, and a label cannot take focus. After focus moves to the dialog, Tab finds nothing to activate inside it. The sheet also has no focus trap and no close button, so Esc is the only way out.
- Pointer and touch users are fine, including iOS Safari: a label-wrapped display:none file input opens the picker on current iOS.
- Fix options:
  - Use `<button>`s that call `inputRef.current.click()`. Programmatic click inside a user gesture works on iOS 13+ and Android.
  - Or visually hide the inputs (sr-only clip pattern instead of `hidden`) and add a `:focus-within` ring to the label.
  - Either way, add a "Đóng" button like the other sheets.

## Low

### L1. Focus restore lands on a disabled button
- `recapture-page-sheet.js:18` and `book-status-view.js:163-164`
- `recapture()` calls `setRecaptureTarget(null)`, which unmounts the sheet, in the same batch as adding the page to `recapturing`. The cleanup returns focus to the "Chụp lại" opener, which then re-renders as `disabled`, so focus drops to `<body>`.
- Minor for screen-reader users. The same pattern already exists for retry.

### L2. No size hint when decoding very large photos
- `web/js/image-downscale.js:41`
- `createImageBitmap(file, {imageOrientation})` decodes at full resolution. A 48MP iPhone photo is about 190MB RGBA, which can hit the iOS memory ceiling.
- The `<img>` fallback catches the rejection. But if WebKit kills the tab, there is no rejection to catch.
- The input does not need to be the full camera image: iOS `capture` usually yields about 12MP, and the picker can return 48MP ProRAW-to-JPEG. Consider passing `resizeWidth`/`resizeHeight`, but that needs dimensions first, so it is optional. Also note this for manual iPhone QA.

### L3. Unverified EXIF orientation on older Safari
- `image-downscale.js:41`
- If an engine ignores `imageOrientation` and does not apply EXIF, the bitmap path succeeds with a sideways image and the `<img>` fallback never runs. The canvas JPEG then drops EXIF, so the server receives a rotated page.
- Modern Chrome and Safari apply EXIF for Blob sources. Needs one manual check on the oldest supported iOS, holding the phone in portrait.

### L4. Encode failures in live capture now show a different message
- `web/js/camera-capture.js:95-99`
- Encode failures in the OffscreenCanvas path used to reject with a raw Error, so `capture-view.js:164` showed "Không chụp được ảnh, thử lại". They are now wrapped in `CameraError`, so the UI shows "Không tạo được ảnh".
- This is harmless: `setCameraError` is called in both branches, so nothing goes to a different screen. It meets criterion 6. It is only a wording change.

### L5. Rare error paths after commit
- `pages_routes.py:122-127`
- If `unlink` raises a non-FileNotFound OSError after commit, the client gets a 500 for a swap that succeeded. Same pattern as discard.
- If the book is deleted between commit and the final `get`, `page_out(None)` returns a 500. Same pattern as retry.
- If the DB raises something other than the 409 path, the new tmp file is left for the orphan sweep (≥1h). Same as `upload_page`.
- All three are acceptable and consistent with existing code.

### L6. Test gaps
- `tests/test_page_recapture.py`
- Not covered:
  - `ocr_processing` in the non-failed 409 loop. It is covered by the SQL condition, but a one-line addition is cheap.
  - The cleanup race in M1.
  - No-orphan after 413/415. Validation runs before the write, so this is fine by construction.
- `test_replace_image_validates_image` mutates `ctx.settings.max_upload_bytes`. That is fine only if the `app` fixture is per test; it appears to be.

## Checked: no issue
- **Concurrent replace vs replace:** `_write_lock` plus `BEGIN IMMEDIATE` serialise them. The loser gets 409 and its file is unlinked.
- **Replace vs retry or discard:** each is gated on status inside its own transaction, so whichever commits first wins and the other gets 409. Discard's pre-read `before` is harmless, because discard returns None when the page is `uploaded`.
- **Replace vs OCR worker:** `failed` is never touched by `claim_next_uploaded` (status='uploaded'), `mark_failed` or `mark_ocr_done` (both require `ocr_processing`). Worker conditions are unchanged.
- **Claim order:** `claim_next_uploaded` orders by `created_at`, and the recaptured row keeps its original `created_at`, so it is claimed early. That is desirable.
- **Ordering invariant:** confirmed in `chunker_worker.py:37-45`. A failed page `break`s the loop, so later pages are not chunked. Covered by `test_recaptured_page_rejoins_chunks_in_order`.
- **Auth:** `CurrentUser` dependency plus `load_book`. This is stricter than `retry_page`, which skips `load_book`. Books have no per-user ownership in `load_book`, so it is consistent with the other page routes.
- **Public contracts:** additive only (new route, `pagesApi.replaceImage`). `upload_page` behaviour, error codes and file naming are unchanged. `fitLongEdge`, `LONG_EDGE` and `JPEG_QUALITY` constants are unchanged (2000 / 0.85).
- **PWA:** `SHELL_CACHE` v33 matches `APP_VERSION` 33. Both new modules are in `SHELL_ASSETS` and `modulepreload`.
- **OffscreenCanvas:** the `typeof` guard is kept, so there is no ReferenceError on iOS < 16.4.
- **Input reset:** `input.value=''` lets the same file be picked again.

## Recommended Actions
1. M1: make `clear_image` conditional on `status='failed' AND image_path=<snapshot>`. Small change that also fixes the existing retry race. Add a test that interleaves the expiry snapshot and a recapture.
2. M2: make the sheet actions keyboard-reachable and add a close button.
3. Manual QA on an iPhone with a portrait photo: check orientation (L3) and full-size picker photos (L2).
4. Optional: add `ocr_processing` to the 409 status loop in the test.

## Plan follow-ups
- Acceptance criteria 1 to 5 are met by the code and tests.
- Criterion 6 is met. The only change is the L4 message wording.
- Phase 3 (verify/release) still needs on-device iOS QA.

## Unresolved Questions
- Is the cleanup race in M1 in scope here, or a follow-up? It predates this change through retry.
- Lowest iOS version to support for the EXIF and createImageBitmap behaviour?
- When the native camera opens from a standalone (home-screen) iOS PWA, iOS can sometimes reload the page under memory pressure. The selected file would then be lost silently. Has this been tested?

Status: DONE_WITH_CONCERNS
Summary: Backend swap is atomic and file-safe, with no blockers. Fix the cleanup_worker `clear_image` race (M1) and keyboard access in the sheet (M2) before release.
