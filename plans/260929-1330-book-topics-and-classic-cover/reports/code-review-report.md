# Code Review: book topics + classic cover

## Scope
- Backend: app/db.py, app/repositories/{topic,book}_repository.py, app/api/{books,topics}_routes.py, serializers.py, app_context.py, main.py, tests/test_topics_api.py
- Web: book-cover.js, topic-input.js, library-view.js, capture-view.js, player-sheet.js, reader-view.js, api-client.js, tokens.css, library.css, sw.js
- Checks run: `pytest -q` → 110 passed. ruff is not installed in .venv, so lint was not run. SW precache: every file under web/js/** is listed in SHELL_ASSETS, so no offline import gap.

## Overall
Solid and small. New fields are additive only. The migration is append-only, and the v2→v3 upgrade is tested. Owner check runs before any topic write. get_or_create cannot race, because INSERT … ON CONFLICT DO NOTHING followed by SELECT is atomic per statement on a single connection with a write lock. No Critical or High issues. There are a few Medium contract/UX gaps and one plan inconsistency that needs a decision.

## Critical
None.

## High
None.

## Medium

M1. Plan acceptance contradicts the design and the code on empty topic.
- Plan acceptance says "Tên chủ đề rỗng / >40 → 400 field=topic". Plan API table says `null`/`""` = remove topic.
- Code: `resolve_topic_id` (app/api/books_routes.py:50-56) turns ""/whitespace into None, which clears the topic. It does not return 400. The test `test_patch_topic_owner_only_and_clear` asserts "   " → cleared.
- The code follows the API table, which is the sensible reading. The acceptance line needs to be corrected to "rỗng = bỏ chủ đề". The lead should confirm.

M2. A PATCH can partially apply and still return 400. File: app/api/books_routes.py:107-110.
- Scenario: `PATCH {title:"New", topic:"x"*41}`. `update_title` commits first, then `resolve_topic_id` raises 400. The client sees an error, but the title has already changed.
- The web client sends topic alone, so the UI is not affected. It is still an API contract smell.
- Fix: validate/resolve everything before writing. Call `_clean_title(...)` and `resolve_topic_id(...)` first, then run the updates.

M3. `/api/topics` sort order is code-point order, not name order. The test only restates the implementation.
- File: app/repositories/topic_repository.py:57 uses `ORDER BY t.name_key`, which is a casefolded Unicode code-point sort. "Âm nhạc" (U+00E2) sorts after "Thiếu nhi". The plan says "sắp theo tên".
- tests/test_topics_api.py `test_topics_sorted_and_require_auth` asserts `sorted(names, key=topic_key)`, the same code-point key, so it passes by construction and proves nothing about Vietnamese ordering.
- Impact is limited to datalist suggestion order, because library shelves re-sort client-side with `localeCompare('vi')`.
- Fix: either document "order unspecified" and sort client-side in TopicInput, or sort in Python with a Vietnamese-aware key. Change the test to assert ["Âm nhạc","Lịch sử","Thiếu nhi"].

M4. PlayerSheet `topicDraft` can go stale or lose edits. File: web/js/components/player-sheet.js:29, :95-100.
- The sheet only renders while `sheetOpen` (reader-view.js:328), so the draft resets each time the sheet opens. That part is fine.
- Stale value: the draft is never synced to the server's canonical name. Type "VĂN HỌC", commit, and the server returns "Văn học", but the input keeps showing "VĂN HỌC" until the sheet is reopened.
- Stale on failure: if the PATCH fails (offline, 400), the draft keeps the rejected value. `setError` shows the banner in the reader behind the sheet overlay (reader-view.js:292), so the user may not see it.
- Lost edit: the commit only happens on the native `change` event (blur or Enter). If the sheet unmounts while the input still has focus (for example, a tap on a non-focusable backdrop on iOS, or the Escape handler), no change event fires and the edit is silently dropped.
- Fix: in `handleChangeTopic`, return the updated book and `setTopicDraft(updated.topic?.name ?? '')`. On error, reset the draft to `book.topic?.name ?? ''`. Optionally commit in the sheet's onClose.

## Low

L1. Misleading comment in app/db.py (migration 3 comment). It says name_key is "case/diacritic-normalized". It is actually NFC + casefold + collapsed whitespace; diacritics are kept, so "Van hoc" ≠ "Văn học". That is the correct behaviour, but the comment says otherwise.

L2. Normalization gaps. `\s` does not match zero-width or format characters (U+200B, U+FEFF, U+00AD), so "Văn​học" becomes a separate topic that looks the same. Optional fix: strip Unicode category Cf in `clean_topic_name`.

L3. Changing the topic bumps `books.updated_at` (book_repository.py:117). That reorders the library (sorted by updated_at DESC) and restarts the tail-seal grace timer (chunk_repository.py:125). `update_title` already does the same, so it is consistent. Just be aware that a metadata-only edit delays synthesis of the last chunk by one grace period.

L4. Cover a11y duplication. File: book-cover.js:53. `role="img" aria-label="Bìa sách X"` sits inside a link that also shows `.book-card-title` X, so screen readers announce the title twice. Since the visible title is right next to it, make the whole cover `aria-hidden="true"`.

L5. Cover clamp. library.css `-webkit-line-clamp: 5`, but the plan says 4 lines. The vertical fit is fine at scale ≤0.82: 5 lines are about 53cqw against a 60cqw box. `titleScale` uses UTF-16 `.length`, so emoji and astral characters count double and just get smaller type, which is harmless. Browsers without container queries (Safari <16) drop the `cqw` font-size and fall back to the inherited 16px, which still fits in most cases.

L6. Design-guideline drift, library.css:37. `inset 3px 0 0 rgba(0,0,0,.18)` is a hardcoded color and adds a third elevation style. Guidelines §2/§57 say no hardcoded values in components and only 2 elevation levels. The literal `-20px`/`20px` bleed (library.css:70) duplicates `.container`'s literal 20px padding (app.css:37). Fine at 375px (shelf-row width = viewport, no page scroll), but they are coupled. Consider a `--container-pad` token.

L7. Plan said "chỉ chỉnh nhẹ độ sáng ở dark" for the cover tokens, but there is no dark override in tokens.css. Contrast of ink #F6ECD6 on #6B2424 is about 10:1, so it is readable in both themes. This is a deviation from the plan, not a defect.

L8. Test gaps: no test for PATCH topic >40 → 400, the exact 40-character boundary, or `topic:""` on create. The NFD test literal was verified to really contain combining marks (U+0306/U+0323), so that test is not a phantom.

L9. The docs/system-architecture.md diff also rewrites the unrelated chunk-claim section. Check whether that belongs in this change or came from earlier uncommitted work.

## Verified OK
- `patch_book` calls `ensure_book_owner` before any topic write, and non-owners get 403 (tested).
- PATCH semantics: `"topic" in model_fields_set` means omitted = unchanged and null/"" = clear (tested).
- `row_to` only takes the columns a dataclass declares, so `Book` from `SELECT *` still works with the new `topic_id` column. `BookSummary` is only built through `row_to` and has no positional construction. `BookRepository.create` gained `topic_id` as an optional last argument, and its only caller is books_routes.
- Offline cache entries saved before this change have no `topic` → undefined → the book lands in "Chưa phân loại". No crash.
- Migration: ADD COLUMN with REFERENCES and default NULL is legal in SQLite. It runs in BEGIN/COMMIT inside executescript, and the v2 fixture keeps its data.
- Preact 10 applies `'--title-scale'` via `style.setProperty` with a raw number and no px suffix. `onChange` maps to the native `change` event.
- Shelf keys/ids: topic ids are uuid hex, so they cannot collide with the 'unsorted' sentinel.
- No N+1: the topic comes from a LEFT JOIN in `_SUMMARY_SQL`, and there is an index on books.topic_id.
- SW: SHELL_CACHE was bumped to v5 and topic-input.js is precached.

## Acceptance status
- [x] New topic created and reused case-/space-insensitively (tested)
- [x] Non-owner PATCH → 403; null clears; empty topic hidden (tested)
- [~] >40 → 400 field=topic (tested on create only). Empty → 400 is NOT the behaviour; see M1.
- [x] v2→v3 migration keeps data; all 110 tests pass
- [x] Shelves by topic with "Chưa phân loại" last; no page-level horizontal scroll at 375px (verified from CSS by reasoning, not in a browser)
- [~] Long titles on cover do not overflow (clamped at 5 lines, not 4); light/dark readable. Needs a visual check.
- [x] Mockups/shots updated (docs/mockups/shots/*, cover-preview.html)

Status: DONE_WITH_CONCERNS
Summary: No Critical or High issues. The contract is additive, authz is correct, and the migration is safe. Medium issues: the plan's empty-topic acceptance contradicts the design, PATCH can partially apply before a 400, topics are sorted by code point and the test cannot catch it, and the PlayerSheet draft can go stale or lose edits.
Concerns: M1 needs a lead/user decision (the acceptance line vs the API table).

## Unresolved questions
- Should an empty topic be rejected with 400 (acceptance line) or clear the topic (API table and current code)?
- Should the cover be aria-hidden (visible title is adjacent) or keep role=img?
