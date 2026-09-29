---
name: chunk-counter-semantics
description: book_out chunks.processing counts the pending unsealed tail; frontend phase logic that tests processing>0 can never reach tail_wait
metadata:
  type: project
---

In `book_out` (app/api/serializers.py + book_repository.py chunk stats), `chunks.processing` = SUM(status IN ('pending','processing')), which INCLUDES the unsealed tail held by the grace period. `chunks.queued` = processing OR sealed pending (excludes tail). `tail_waiting` implies tail_pending>0, so processing>=1 whenever tail_waiting is true.

**Why:** Found 2026-09-29 in smart-progress review: `phaseOf` checked `queued>0 || processing>0` before `tail_waiting`, so tail_wait (and the "Xong rồi, đọc luôn" button) was unreachable; JS test fixtures used impossible `processing:0, tail_waiting:true`.

**How to apply:** When reviewing any client/phase logic over these counters, check it uses `queued` not `processing` for "work still running", and check test fixtures reflect real server shapes.
