# Red-team plan review: Failure Mode Analyst (Flow Tracer)

Plan: `plans/260929-1636-smart-progress-and-voice-picker/` (plan.md + phases 1-8). Code was traced against the working tree, with the WIP counted as current code.

## Flow traces (verification)

- **T1: grace branch of claim.** `worker.py:242-252` `claim_and_process_chunk` runs in this order: `requeue_expired_quota`, then clear the expired `_pause_until`, then `if not available: return False` (line 249-250, which returns early before any claim), then `grace_cutoff`, then `claim_next_pending` (`chunk_repository.py:98-141`). The eligibility condition is `c.status='pending' AND b.tts_provider IN (available) AND (c.sealed=1 OR (b.updated_at <= cutoff AND NOT EXISTS page uploaded|ocr_processing))`. The claim then sets `sealed=1` and copies `provider/voice` from `books`.
  - Result: phase 1's `tail_waiting = tail_pending>0 && pages_processing==0` plus `tail_ready_at = updated_at+grace` matches the SQL. It does not match the Python-level early return. When a provider is paused, the tail is never claimed, even after `tail_ready_at`. PARTIAL.
- **T2: who bumps `books.updated_at`.** `touch()` is called from `pages_routes.py:66` (upload) and `:81` (discard), `worker.py:197` (OCR done), and `chunker_worker.py:74` (chunk). The PATCH path also bumps it through `update_title` (`book_repository.py:138`), `set_topic` (`:117`), `change_voice` (`:149`) and the planned `set_voice_for_new_content`.
  - Result: all of these use the same column that the claim reads, so `tail_ready_at` mirrors the claim correctly. A title or topic edit restarts the grace window, and the countdown shows that correctly. OK.
- **T3: waiting_quota and the tail.** A claim always sets `sealed=1` (`chunk_repository.py:114`). `requeue_expired_quota` (`:180-185`) and `change_voice` (`book_repository.py:152-155`) never reset `sealed`.
  - Result: `waiting_quota` and requeued chunks can never be counted as the tail. OK.
- **T4: seal ↔ `replace_tail` race.** `chunker_worker.py:31` reads the tail, then `:67` calls `replace_tail`, which runs `DELETE ... WHERE id=? AND status='pending'` (`chunk_repository.py:86`). The phase 1 analysis of this race is correct.
  - It is also incomplete: `update_text` (`chunk_repository.py:46-52`, called from `audio_routes.py:28`, with no status guard) hits the same race and can lose data (Finding 9).
- **T5: PATCH-before-camera.** `capture-view.js:102-106` sets the hash to `#/capture/:id`. `app.js:114` then remounts `CaptureView` with `key=bookId`, and `capture-view.js:12` sets `step='camera'` directly. Every `#/capture/:id` entry skips the choose step (Finding 6).

---

## Finding 1: The tail-wait status overrides the TTS status and hides active synthesis
- **Severity:** High
- **Location:** Phase 6, section "Dòng trạng thái" (priority 4 before 5) and "ETA" ("Không hiện khi ... tail_waiting"). Phase 7, label `tail_wait`. Phase 1, "Requirements" (only a bool is exposed).
- **Flaw:** `tail_waiting` becomes true as soon as OCR finishes and a tail exists. That happens even when many sealed chunks are still `pending` or `processing` ahead of it. The API gives the client no way to tell "only the tail is left" apart from "12 chunks are still in the TTS queue plus the tail". The phase 6 test "tail_waiting thắng tts khi chunks.processing chỉ gồm tail" cannot be implemented from the fields the plan exposes.
- **Failure scenario:** The user captures 10 pages. OCR finishes in about 1 minute. The chunker creates 12 sealed chunks plus 1 tail. TTS (RPM 10, 5-15s per call) needs about 2-3 minutes. For that whole time the screen says "Đang chờ thêm trang… đoạn cuối sẽ đọc sau 1:30", the ETA is hidden and the library shows "Chờ thêm trang". The screen misreports what the app is doing, which is the exact problem this plan is meant to fix (plan.md:22).
- **Evidence:** `book_repository.py:91` `SUM(status IN ('pending', 'processing')) AS processing` (this count includes the tail). Phase 1 only exposes `tail_waiting/tail_ready_at/tail_wait_seconds`. Phase 6 lines 26-27 put `tail_waiting` before `chunks.processing > 0`.
- **Suggested fix:** Expose `chunks.tail_pending` (the count already exists in the planned SQL), or expose `chunks.queued = processing - tail_pending`. `phaseOf` should return `tail_wait` only when `chunks.processing - tail_pending == 0`. Otherwise show the TTS line with ETA, plus a secondary line "đoạn cuối chờ thêm trang".

## Finding 2: `phaseOf` is unsafe if derived from `state`, and a paused provider leaves the countdown stuck at 0
- **Severity:** High
- **Location:** Phase 6, "Dòng trạng thái" priorities 1-2 and "Nút Xong rồi, đọc luôn". Phase 1, "Requirements" (the claim that `tail_waiting` "phải khớp đúng nhánh grace"). Acceptance criterion #7 ("tail được TTS ngay").
- **Flaw:** `book_state` returns `processing` whenever any chunk is `pending`, including the tail. So `failed` and `waiting_quota` never surface while a tail exists. Separately, the provider pause lives only in worker memory. The claim is skipped whenever the provider is paused, and nothing in the API reports that. After `change_voice` (the default regenerate=true path) resets every chunk, `not_before` is set to NULL, so `chunks.waiting_quota` becomes 0 while `_pause_until` is still active.
- **Failure scenario:**
  - (a) Page 3 fails OCR. The tail is pending, so `state='processing'`, and the status view shows the countdown instead of "Có trang lỗi".
  - (b) Gemini returns 429, the provider is paused for 1h, and the user presses "Xong rồi, đọc luôn". The seal succeeds with 204. The UI then shows "Đang chuyển giọng đoạn…" for an hour while nothing is being synthesized, and acceptance #7 fails. The countdown reaches 0:00 and then shows "Sắp đọc đoạn cuối…" indefinitely.
- **Evidence:**
  - `serializers.py:27-30`: `if b.pages_processing or b.chunks_processing: return "processing"` is checked before `waiting_quota` and `failed`.
  - `worker.py:248-250`: `if not available: return False` returns before the claim.
  - `worker.py:289`: `self._pause_until[chunk.provider] = ...` (in memory only).
  - `book_repository.py:153`: `SET status='pending', not_before=NULL`.
- **Suggested fix:**
  - `phaseOf` must use raw counters (`pages.failed`, `pages.blocked_at_seq`, `chunks.waiting_quota`), not `book.state`. Say so explicitly and add tests.
  - Expose the provider pause, either as `provider_paused_until` on the book or by reusing the `usage_summary` status.
  - Seal-tail should return, or the UI should show, "đang chờ lượt Gemini" when the provider is paused.
  - Add a test: tail pending + failed page gives the `failed` phase.

## Finding 3: Rolling back the backend turns `regenerate:false` into a full regenerate
- **Severity:** High
- **Location:** Phase 2, "Risk Assessment → Rollback". Phase 8, "Risk Assessment" ("revert commit frontend + backend", "client cũ vẫn chạy").
- **Flaw:** `BookPatchIn` silently ignores unknown fields (pydantic's default `extra='ignore'`). After a backend revert, any client still running the new JS sends `{tts_voice, regenerate:false}`. The old server ignores `regenerate` and runs `change_voice`, which requeues every chunk of the book. The new shell is cached cache-first and stays alive until the SW update check, and JS already loaded in open tabs keeps running.
- **Failure scenario:** Prod is rolled back. A user on the cached v15 shell adds pages to a 200-chunk book and picks a new voice. All 200 done chunks are requeued, the whole RPD quota for the day is burned, and the old-voice audio is replaced. That is the opposite of D3/D8, and it cannot be undone.
- **Evidence:**
  - `books_routes.py:31-35`: `class BookPatchIn(BaseModel)` has no `model_config`.
  - `books_routes.py:122-123`: `await ctx.books.change_voice(...)`.
  - `book_repository.py:152-156`: `UPDATE chunks SET status='pending' ... WHERE book_id=?`.
  - `sw.js:145-153`: `cacheFirstShell`.
- **Suggested fix:** Make the operation fail closed. Use a new endpoint `POST /api/books/{id}/voice` (new content only), so an old server answers 404/405 instead of silently regenerating. Alternatively, ship `regenerate` in its own commit marked as never-revert, and have the client refuse to PATCH a voice unless `/api/voices` advertises a capability flag. Document the rollback order.

## Finding 4: "Trang đã có giữ giọng cũ" is false for old-page chunks that are still pending, waiting_quota or failed
- **Severity:** High
- **Location:** Phase 2, "Architecture" ("chunk pending/waiting_quota ... và failed được retry sẽ nhận giọng mới"). Phase 4, "Sách có sẵn" (the warning copy). Brainstorm D8.
- **Flaw:** The voice is bound to a chunk when it is claimed, not when its content is created. Every old-page chunk without audio switches to the new voice. That includes sealed chunks parked in `waiting_quota` for hours and `failed` chunks retried later. So voice changes land at arbitrary positions in the book, not at the page boundary. A chunk that was `processing` when the PATCH arrived keeps the old voice. The phase 2 test "chunk pending sau claim có voice mới" asserts this behavior instead of catching it.
- **Failure scenario:** On the free tier, a 40-chunk book has 10 chunks done and 30 in `waiting_quota` until Pacific midnight. The user adds 2 pages and picks Orus, and the UI says "các trang đã có giữ giọng Kore". The next day, chunks 10-39 (old pages) are read by Orus. Chunk 5, which had failed and is retried a week later, is also Orus, so a single chapter is split Kore, Orus, Kore.
- **Evidence:**
  - `chunk_repository.py:114-116`: `voice=(SELECT tts_voice FROM books ...)` runs at claim time.
  - `chunk_repository.py:180-185`: `requeue_expired_quota` sets status back to `pending`.
  - `chunk_repository.py:54-60`: `reset_for_retry` does the same.
  - Phase 4 line 28: "các trang đã có giữ giọng {Y}".
- **Suggested fix:** Either make the copy truthful ("{N} đoạn chưa có audio, gồm cả trang cũ, sẽ dùng giọng X"), with N from `chunks.total - chunks.done`, or persist the intended voice on existing non-done chunks at PATCH time. The second option needs a column or a `voice_locked` flag, which contradicts "không thêm migration", so the decision needs the user. Add a test covering a `waiting_quota` old-page chunk.

## Finding 5: The voice whitelist accepts providers that are not configured, which silently fails every new chunk
- **Severity:** Medium
- **Location:** Phase 2, "Requirements" (whitelist only). Phase 4, `orderVoices` ("cả 2 provider đều có mặt").
- **Flaw:** `/api/voices` lists Azure voices unconditionally, and phase 2 validates only the voice name. When Azure has no key, a chip for an Azure voice is still selectable. Preview returns 409, but PATCH or create is accepted. The worker's router does contain `azure` (it is built with an empty key), so claims succeed and then fail with a non-retryable error.
- **Failure scenario:** The user taps "Nam · Azure". Preview shows "Giọng này chưa được cấu hình", but the chip stays selected and the user proceeds. Every new chunk ends up `failed` with "Chưa cấu hình azure". Because `regenerate=false` has no UI to revert it, the book is stuck with new pages that cannot be synthesized.
- **Evidence:**
  - `voices_routes.py:21-22`: both providers are always listed.
  - `main.py:62`: `"azure": AzureTtsProvider(settings.azure_speech_key, ...)`.
  - `tts_azure.py:35-36`: `raise TtsError("Chưa cấu hình azure", retryable=False)`.
  - `tts_router.py:46-47`: a non-retryable error is raised immediately.
- **Suggested fix:** Create and PATCH should return 409 `provider_unavailable` when the provider is not configured (use `quota_policies(...)`; note it returns a list, not a dict, per `usage_quota.py:40`). `/api/voices` should add `configured` per provider, and the picker should disable those chips.

## Finding 6: Entering capture by URL skips the voice step, and PATCH-before-camera leaves orphan voice changes
- **Severity:** Medium
- **Location:** Phase 4, "Sách có sẵn" and "Player-sheet" (bỏ đổi giọng).
- **Flaw:** Only the choose-list button opens the new panel. `#/capture/:id` mounts straight into the camera. The status view's "Thêm trang" button and any reload or back navigation use that URL. With the player-sheet selector removed, the only way to change an existing book's voice is bottom-nav → Chụp → click the book.
  - The PATCH is also committed before the camera opens. If camera permission is denied (common on iOS PWA) or the user backs out, the voice has already changed with zero new pages. The tail and any pending or waiting_quota chunks are now re-voiced (Finding 4), and there is no UI to revert it.
- **Failure scenario:** On the status view the user taps "Thêm trang", the camera opens directly, and there is no voice choice, so D7 is broken for the main path. In another case, the user picks Orus and the PATCH succeeds. Then `getUserMedia` fails and the user leaves. The book's unsynthesized chunks are silently switched to Orus.
- **Evidence:**
  - `capture-view.js:12`: `useState(bookId ? 'camera' : 'choose')`.
  - `app.js:114`: `<${CaptureView} bookId=${route.bookId} key=${route.bookId || 'new'} />`.
  - `book-status-view.js:152`: `href="#/capture/${bookId}"`.
  - `capture-view.js:47-50`: the camera start error path.
- **Suggested fix:** Route `#/capture/:id` through the panel when `can_manage` (for example with a `?voice=1` step, or by showing the panel whenever the step is not already confirmed in the session). Defer the PATCH until the first `enqueue` or first upload success. The tail is only claimed after grace, so a PATCH made before the first upload's OCR still applies to new chunks.

## Finding 7: "Xong rồi, đọc luôn" and the "ready" state can fire while this tab is still uploading pages in the background
- **Severity:** Medium
- **Location:** Phase 6, "Nút Xong rồi, đọc luôn", "Khi chuyển sang ready trong phiên" and "Polling" (`active` = has work).
- **Flaw:** `finish()` explicitly lets the user leave with uploads pending ("vẫn tiếp tục tải nền"). The queue loop keeps running after `CaptureView` unmounts. The server only knows about pages it has received, so between two slow uploads it sees `pages_processing=0`. That makes `tail_waiting` true and the button appears. After a seal, the book can briefly become `ready`. The polling hook then deactivates (`active=false`) and fires the "Sách đã sẵn sàng" toast. The remaining uploads land afterwards and the view never refreshes.
- **Failure scenario:** On 3G, 6 pages are captured, pages 0-3 are uploaded, the user taps Xong and confirms, then taps "Xong rồi, đọc luôn". The tail is synthesized, the book becomes ready, and the toast and CTA appear while polling stops. Pages 4-5 finish uploading 40s later. The status view shows a "ready" book that is missing 2 pages until a manual reload. Page 4's continuation also starts a new chunk, splitting a sentence.
- **Evidence:**
  - `capture-view.js:132-137`: `finish()` navigates away with `pending > 0`.
  - `upload-queue.js:112-118`: the `_run` loop is not tied to component lifetime.
  - `book-status-view.js:23-26`: polling stops when `hasWork` is false.
  - `serializers.py:24-33`: `ready` once nothing is pending.
- **Suggested fix:** Keep a module-level registry of `UploadQueue` per bookId. The status view should keep `active=true`, hide the seal button and suppress the ready toast while the local pending upload count is above 0. Show "Đang tải trang N lên…" as the highest-priority status line.

## Finding 8: The voice preview can hang for minutes, bypasses the worker's quota pause, and serves stale cached audio
- **Severity:** Medium
- **Location:** Phase 3, "Requirements (Cache miss)", "Risk Assessment". Phase 4, "Preview" error mapping. Phase 8, "Service worker".
- **Flaw:**
  - (a) The per-key lock is held across `RpmLimiter.throttle()`, which sleeps up to 60s when the worker is using all 10 RPM, and across a Gemini call with a 120s SDK timeout. One preview can take about 3 minutes while every same-key request queues behind it, and the phase 4 fetch has no abort or timeout.
  - (b) Preview ignores the worker's `_pause_until`, so it calls Gemini during a quota pause. In the other direction, a preview 429 does not pause the worker.
  - (c) The URL `/api/voices/{p}/{v}/preview` is sent with `Cache-Control: max-age=86400` but is style-agnostic. After a style or model change, browsers keep serving the old preview for 24h.
  - (d) A client abort or server shutdown between writing the `.tmp` file and `os.replace` orphans the `.tmp` in `voice-previews/`. Cleanup only sweeps `tmp_dir`.
  - (e) When offline, the SW returns 503 `{code:'offline'}`, which phase 4 maps to "Hết lượt Gemini".
  - (f) The cache key reads `settings.gemini_tts_style`, but the provider bakes the style in at construction time. The test "đổi style → cache miss" validates the key, not the audio.
- **Failure scenario:** While a 40-chunk book is being synthesized, the user taps ▶ Charon, sees a spinner for about 70s, taps another chip, and the first request keeps holding the lock and quota. During a daily-quota pause every uncached chip click burns a 429.
- **Evidence:**
  - `worker.py:65-72`: `await asyncio.sleep(60.0 - (now - self._hits[0]))`.
  - `tts_gemini.py:15`: `GEMINI_TIMEOUT_MS = 120_000`.
  - `tts_gemini.py:23-26`: `self._style_prompt = style_prompt` is fixed at construction.
  - `worker.py:107,289`: `_pause_until` is in memory and private to the worker.
  - `sw.js:136-141`: offline returns 503.
  - `config.py:29`: `gemini_tts_rpm: int = 10`.
- **Suggested fix:**
  - Check a shared pause state before synthesizing (move `_pause_until` to a `ProviderPause` on `AppContext`, shared by both).
  - Do a non-blocking RPM check and return 503 with `Retry-After` when no slot is free.
  - Wrap the synth in `asyncio.wait_for(..., 20)`.
  - Put the cache key in the URL (`?v=`), or use `no-cache` with an ETag.
  - Unlink the `.tmp` in a `finally` block, and map `offline` and `network_error` separately.
  - Derive the cache key from the provider instance's own style or model.

## Finding 9: The seal race analysis misses the same race on chunk edit, where data is actually lost today
- **Severity:** Medium
- **Location:** Phase 1, "Architecture → Race đã kiểm chứng" and "Risk Assessment" ("Mức nghiêm trọng thấp", "không mất dữ liệu").
- **Flaw:** `update_text` sets `sealed=1, status='pending'` on any chunk without a status guard, including the unsealed tail. If it lands between the chunker's `get_unsealed_tail` and `replace_tail`, the `DELETE ... status='pending'` succeeds. The user's edited text is deleted and replaced by the chunker's re-split of the pre-edit text. That is silent data loss, not just a missed seal. The planned `sealed=0` guard fixes it, but the plan neither states this nor tests it, so a later refactor could remove the guard as "only cosmetic".
  - The `TailBusyError` docstring update should also mention edits.
  - The plan rates the fix's severity as "thấp", which leaves it at risk of being dropped.
- **Failure scenario:** While page 7 is being chunked, the user corrects an OCR typo in the last chunk from the reader and gets 200. Two seconds later the correction is gone and the tail contains the old text plus page 7.
- **Evidence:**
  - `chunk_repository.py:46-52`: `UPDATE chunks SET text=?, sealed=1, status='pending' ... WHERE id=?`, with no status or sealed guard.
  - `audio_routes.py:28`: `await ctx.chunks.update_text(chunk_id, text)`.
  - `chunk_repository.py:86`: `DELETE FROM chunks WHERE id=? AND status='pending'`.
  - `chunker_worker.py:31,67`: read, then write, without a lock.
- **Suggested fix:** Raise the fix's severity to Medium (it causes data loss). Add a red test: `get_unsealed_tail` → `update_text(tail)` → `replace_tail(old tail)` raises `TailBusyError`, and the edited text survives. Note in the risk section that the guard protects both seal and edit.

---

## Unresolved questions
1. D8 wording versus how the voice is actually bound (Finding 4). Should the product keep the "old pages keep old voice" promise, which needs a schema change, or should the copy be weakened?
2. Does the product accept that a provider pause is invisible to the UI (Finding 2), or should the in-memory `_pause_until` be moved to shared state or the DB?
3. Rollback policy: can backend and frontend be reverted independently, given the ignored `regenerate` field (Finding 3)?

Status: DONE_WITH_CONCERNS
Summary: The phase 1 seal↔replace_tail race analysis is correct, and `tail_waiting` does mirror the SQL grace branch. It misses the in-memory provider pause, the chunk-edit race and the "processing" state masking. The plan also has an unsafe rollback path (`regenerate` is silently ignored by old code, so it regenerates everything), a false "old pages keep old voice" promise, and status and polling logic that misreports progress while TTS or background uploads are active.
