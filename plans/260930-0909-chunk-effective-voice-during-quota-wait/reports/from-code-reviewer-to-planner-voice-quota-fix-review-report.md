# Code Review: effective chunk voice + provider-switch quota release

## Scope
- Files: app/api/serializers.py, app/api/audio_routes.py, app/api/books_routes.py, app/repositories/book_repository.py, tests/test_voice_change.py, tests/test_chunk_effective_voice.py (new)
- LOC: ~+130 (about 40 prod, 90 test)
- Touchpoints checked: chunk_repository.py (claim_next_pending, mark_waiting_quota, quota_waits, requeue_expired_quota), worker.py:238-300, usage_quota.py:62, web/js (every consumer of chunk `voice`/`provider`)

## Verdict
The two criteria hold for the normal path. One confirmed race (below) still lets a chunk get stuck on the old provider's quota after a provider switch. Only one chunk is affected at a time, but it is the same symptom the task set out to fix. Nothing blocks shipping, but it should be fixed or explicitly accepted.

## Medium

**M1. A chunk that is mid-TTS when the provider switches still gets parked on the old provider's quota.** Proven with a scratch probe. It shows `('waiting_quota', 'gemini')` and returns `claimable by azure: False` after the switch to azure.
- Sequence: the worker claims chunk X on gemini (status `processing`). The user sends PUT /voice to switch to azure. `set_voice` (book_repository.py:161-169) releases only chunks that are already `waiting_quota`, so X is not touched. Gemini then returns 429. `mark_waiting_quota` (chunk_repository.py:164) still matches, because status is `processing` and the claim_token is unchanged, so X is parked for `retry_after` (default 1h, worker.py:287).
- Effect: azure cannot claim X until that time passes (`claim_next_pending` only takes `pending` chunks). Meanwhile `chunk_out` shows X as `waiting_quota` with the azure voice, which is misleading. Later chunks get audio while X stays silent, which leaves a gap in the playlist.
- Why it is likely: when quota runs out, the chunk that is in flight is the one that gets the 429. Router backoff retries make that window longer.
- Suggested fix (smallest): make `mark_waiting_quota` park the chunk only if the book is still on the chunk's provider. Otherwise put it back to pending.
  ```sql
  UPDATE chunks SET
    status = CASE WHEN provider = (SELECT tts_provider FROM books WHERE id = chunks.book_id) THEN 'waiting_quota' ELSE 'pending' END,
    not_before = CASE WHEN provider = (SELECT tts_provider FROM books WHERE id = chunks.book_id) THEN ? ELSE NULL END,
    attempts = attempts + 1, error = ?, claim_token = NULL, updated_at = ?
  WHERE id = ? AND status = 'processing' AND claim_token = ?
  ```
  The worker's `_pause_until[old]` is still set, so the old provider is still backed off. Add a test for the sequence: claim, then PUT azure, then mark_waiting_quota, then azure claims the chunk.

## Low

**L1. `set_voice` compares the book's old provider, not the provider the chunk is parked on** (book_repository.py:162-164). Quota is per key, so the key that matters is `chunks.provider`. Filtering with `... AND status='waiting_quota' AND provider IS NOT ?` (the new provider) would do three things:
- remove the extra SELECT,
- also release leftover chunks parked before this fix was deployed (for example, parked on gemini while the book is already on azure). Today those stay stuck until `not_before`,
- keep the same behaviour in every case the current tests cover.

Optional, but simpler and more exact.

**L2. The account quota meter stops showing "paused" early.** `usage_summary` (usage_quota.py:62) finds paused providers through `quota_waits`, which counts `waiting_quota` chunks per provider. After a switch releases the only waiting chunks, the old provider shows `ok`/`exhausted` even though the worker's in-memory `_pause_until` still backs it off. This only affects what is displayed and there is no functional impact. Accept it or note it in docs.

**L3. Test comment uses temporal wording.** The header `# --- current behaviour, pinned before the change` (tests/test_chunk_effective_voice.py:32) describes history, not the invariant. Something like "chunks with audio / in flight report their own voice" would be better.

**L4. Missing tests.** Nothing covers the `_chunk_response` 404 when the book is deleted between the write and the re-read, or two PUT /voice requests in a row with different providers. Both work when reasoned through (see below), but nothing pins them.

## Acceptance criteria check

**(a) Serializer (serializers.py:101-114).** Correct.
- `done`/`processing` return their own snapshot. `pending`/`waiting_quota`/`failed` return the book's voice. Among the 5 statuses in `CHUNK_STATUSES` nothing is missed.
- A chunk with a NULL voice:
  - `pending`/`failed`/`waiting_quota`: now get the book's voice. This is the improvement.
  - `processing` with NULL: only possible if the book row is gone. The worker then marks it failed (worker.py:264) and the frontend falls back to `book.tts_voice`.

**(a) set_voice (book_repository.py:148-169).** Correct.
- It runs inside `BEGIN IMMEDIATE` under the write lock.
- `books.updated_at` is not bumped. Asserted in `test_set_voice_new_provider_leaves_other_statuses`.
- With the same provider, chunks are untouched.
- Only this book's `waiting_quota` chunks change.
- `attempts` is not reset. It is not read anywhere in app/, so that is harmless.

**(a) Two PUT /voice requests at the same time.** Safe. The provider comparison uses the row read inside the transaction, not the possibly stale `book` the route loaded. Last writer wins, and the release decision matches what was actually committed.

**(a) Switching away and quickly back** (P to Q releases chunks, then back to P). The released `pending` chunks are not claimed by P, because `_pause_until[P]` removes P from `available` (worker.py:240). No wasted 429.

**(a) `_chunk_response` (audio_routes.py:21-27).** If the book or chunk is deleted concurrently, it returns 404. Before, `chunk_out(None)` raised AttributeError, which gave a 500. This is an improvement. The two reads are not in one transaction, which is fine for a read-only response. The `type: ignore`s were removed.

**(b) Worker.** Nothing changed.
- `claim_next_pending` still copies the provider and voice from `books`.
- `content_hash` uses the claimed `chunk.voice`.
- `_pause_until` is untouched.

**(b) `quota_waits` / `requeue_expired_quota`.** Unaffected. Released chunks leave `waiting_quota`. See L2 for the meter.

**(b) Frontend.**
- reader-view.js:398 `chunk.voice || book.tts_voice` still works and is now more accurate.
- No other web/js code reads the chunk's `provider`/`voice`. The other matches are voice-picker and book `tts_*` fields.

**(c) Contract.** The response shape is unchanged: same keys and types. Only the values of `provider`/`voice` changed for chunks with no audio, which was intended. `chunk_out` is internal and its signature change is covered by its only 3 call sites.

**(d) Patterns.** Consistent with the codebase:
- `ctx: Ctx` helper annotation matches `load_book`.
- `not_found("Không tìm thấy đoạn")` reuses the existing message.
- The transaction and `async with conn.execute` cursor usage match `replace_tail`/`change_voice`.
- The docstring was updated with the reason for the release.

**(e) Checks.**
- `pytest -q -p no:logging`: 193 passed, 1 failed. The failure is `test_service_worker_assets.py::test_every_script_and_stylesheet_is_precached`, caused by the untracked `web/js/background-music*.js` from the parallel background-music work. It is not related to this change.
- The two targeted files: 23/23 passed.
- ruff is not installed in `.venv` or on PATH, so lint was skipped.

## Pre-existing (out of scope, FYI)
- PATCH /chunks and retry have no owner check. This matches the documented shared-library decision (D10), where only voice and delete are restricted to the creator.

## Recommended actions
1. Fix M1 (guard in `mark_waiting_quota`) and add a test for it.
2. Optionally switch the `set_voice` release filter to `provider IS NOT ?` (L1).
3. Add tests for the `_chunk_response` 404 and for two provider switches in a row (L4). Reword the test header (L3).

## Unresolved questions
- Is L2 (quota meter losing "paused" after a switch) acceptable UX, or should the meter use the worker's `_pause_until`?

Status: DONE_WITH_CONCERNS
Summary: Both criteria and all touchpoints check out, tests pass except one unrelated failure, and the response shape is unchanged. One confirmed race: a chunk that is mid-TTS during a provider switch still gets parked on the old provider's quota.
Concerns/Blockers: M1 race (probe-verified). The unrelated service-worker precache test fails because of the parallel background-music files. ruff is unavailable.

---

## Re-review (M1 + L1 + L3 + L4 fixes; L2 accepted as display-only)

### Verdict
All four fixes are correct. I found no new issues at Medium or above. My M1 scratch reproduction now gives the opposite result: the chunk goes back to `pending` and azure claims it (the row reads `('processing', 'azure')`).

### M1: `mark_waiting_quota` (chunk_repository.py:8, 166-180)
- **Parameters:** they bind in the right order (`not_before`, `error`, `now`, `id`, `claim_token`). The claim-token guard is unchanged, so the call still returns True whenever the chunk was ours, whichever way the CASE goes.
- **Atomicity:** the provider check is a subquery inside the same UPDATE, and every write goes through the lock. So `set_voice` is either committed before `mark_waiting_quota` or after it, never half-applied.
  - If `set_voice` commits first, the CASE sends the chunk to `pending`.
  - If `mark_waiting_quota` commits first, `set_voice` then releases the chunk (its provider IS NOT the new one).
- **Switching away and back mid-flight** (gemini to azure to gemini): the providers match again, so the chunk is parked on gemini. That is correct, because gemini really is out of quota.
- **Book deleted mid-flight:** the chunk row is removed by the cascade. The UPDATE matches 0 rows and returns False, which the worker ignores. No crash.
- **Chunk with NULL provider:** this can't reach this code. `process_chunk` marks such chunks failed before synthesizing (worker.py:264).

### Worker quota branch (worker.py:286-290)
- It ignores the return value, which is fine.
- It still sets `_pause_until[old provider]`, so `_available_providers` leaves the old provider out and it gets no more calls.
- The released chunk is picked up once by the new provider:
  - If the new provider succeeds, the chunk is done.
  - If it returns 429, the book is now on that provider, so the CASE parks the chunk and `_pause_until[new]` is set.
  - That gives at most one call per provider switch, and no hot loop.
- If the new provider is already paused, the chunk sits in `pending` until the pause expires.
- **Nit (Low):** the log line `tts outcome=quota ... not_before=` is still written when the chunk was not actually parked. This could mislead in ops logs. Optional fix: log the outcome based on the resulting status.

### L1: `set_voice` (book_repository.py:161-166)
- There is now one UPDATE filtered on `status='waiting_quota' AND provider IS NOT ?`, with no SELECT. It still runs in one transaction with the books UPDATE.
- `books.updated_at` is still not bumped.
- `IS NOT` handles a NULL provider: such a chunk would be released, which is harmless (and can't happen in practice).
- The same-provider test (`test_set_voice_same_provider_keeps_quota_wait`) still pins that parked chunks stay parked when only the voice changes.

### L3 / L4: tests
- The L3 header now states the invariant (test_chunk_effective_voice.py:32).
- The new tests assert real behaviour:
  - the in-flight chunk hit by a 429 after the switch goes back to `pending`, NULL `not_before`/`error`, and is claimable by azure;
  - a 429 on the current provider still parks the chunk;
  - legacy chunks parked on the other provider are released;
  - `_chunk_response` returns 404.
- The 404 test monkeypatches `books.get` rather than deleting the book for real. That is acceptable because it isolates the check that the book is re-read after the write.
- Still not covered (Low, optional): two provider switches in a row.

### Checks
- Full `pytest -q -p no:logging`: 198 passed, 0 failed. The service-worker failure from the background-music work no longer shows up.
- Targeted run (voice_change, chunk_effective_voice, tail_seal): 41 passed.
- ruff: still unavailable.

Status: DONE
Summary: The M1/L1/L3/L4 fixes are verified: the in-flight chunk is no longer stranded on the old provider's quota, `set_voice` is simpler and also releases legacy parked chunks, the worker makes no extra calls to the old provider and does not hot-loop on the new one, and all 198 tests pass.
Concerns/Blockers: none. Optional nit: the quota log line in worker.py:290 still says "quota" when the chunk was sent back to pending.
