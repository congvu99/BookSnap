---
phase: 2
title: Unpark quota wait on provider change
status: completed
priority: P2
dependencies:
  - 1
---

# Phase 2: Unpark quota wait on provider change

## Overview

`PUT /api/books/{id}/voice` đổi sang provider khác → đoạn `waiting_quota` của sách về `pending` ngay để provider mới nhận. Cùng provider thì giữ nguyên chờ, vì quota tính theo key nên chạy lại sẽ lỗi ngay. Docs ([system-architecture.md:142](../../docs/system-architecture.md#L142), [deployment-guide.md:246](../../docs/deployment-guide.md#L246)) đã mô tả hành vi này, nhưng chỉ PATCH cũ làm thật.

## Requirements

- Functional:
  - Provider đổi → `UPDATE chunks SET status='pending', not_before=NULL, error=NULL, updated_at=? WHERE book_id=? AND status='waiting_quota'`
  - Provider giữ nguyên → không đụng chunks.
  - Không đụng `done`, `processing`, `failed`, `pending`.
  - Không bump `books.updated_at` (giữ quy tắc thời gian chờ đoạn cuối, xem docstring `set_voice`).
- Non-functional: update `books` + `chunks` trong cùng một transaction.

## Architecture

- So sánh provider cũ/mới **trong transaction** (đọc `books.tts_provider` bằng `conn`), không dựa vào `book` route đã load, để hai request đồng thời không làm lệch kết quả.
- `attempts` giữ nguyên (lịch sử lần thử).
- Route đã gọi `ctx.worker.wake()` sau `set_voice` → worker nhận đoạn ngay.
- Worker: `_pause_until` chỉ tạm dừng provider cũ; bộ lọc `b.tts_provider IN available` dùng provider mới của sách → nhận được. Provider mới cũng đang tạm dừng → đoạn nằm ở `pending`, bị bỏ qua đến khi hết dừng. Chấp nhận.
- `quota_waits` không sửa: sau khi gỡ, sách không còn đoạn nào chờ theo provider cũ.

```python
async def set_voice(self, book_id, tts_provider, tts_voice) -> None:
    async with self.db.transaction() as conn:
        async with conn.execute("SELECT tts_provider FROM books WHERE id=?", (book_id,)) as cur:
            row = await cur.fetchone()
        await conn.execute("UPDATE books SET tts_provider=?, tts_voice=? WHERE id=?", (...))
        if row is not None and row["tts_provider"] != tts_provider:
            await conn.execute("UPDATE chunks SET status='pending', not_before=NULL, error=NULL, updated_at=?"
                               " WHERE book_id=? AND status='waiting_quota'", (now_iso(), book_id))
```

(Đã kiểm: `row_factory = aiosqlite.Row` → dùng được `row["tts_provider"]`; `db.transaction()` = `BEGIN IMMEDIATE` + `_write_lock` → đọc rồi ghi trong cùng transaction là an toàn khi có request đồng thời.)

## Related Code Files

- Modify: `app/repositories/book_repository.py` (`set_voice` + docstring)
- Modify: `tests/test_voice_change.py` (thêm test)
- Modify: `docs/system-architecture.md:142,151,437` (PATCH → `PUT /voice`; dòng 437 chỉ còn: provider đổi → `waiting_quota` về `pending`; đoạn chưa có audio hiện/dùng giọng sách)
- Modify: `docs/deployment-guide.md:160,246` (ghi rõ đổi giọng qua bước chụp thêm trang)

## Implementation Steps

1. **Tests Before** (phải qua ngay):
   - `test_set_voice_same_provider_keeps_quota_wait`: claim → `mark_waiting_quota` (not_before +1h) → `PUT /voice` gemini/Orus → DB `status='waiting_quota'`, `not_before` giữ nguyên.
2. **Tests New** (đỏ):
   - `test_set_voice_new_provider_requeues_quota_wait(azure_configured)`: claim → `mark_waiting_quota` (+1h) → `PUT /voice` azure/`vi-VN-NamMinhNeural` → DB `status='pending'`, `not_before IS NULL`, `error IS NULL`; API chunk `provider == "azure"`, `voice == "vi-VN-NamMinhNeural"`.
   - `test_set_voice_new_provider_leaves_other_statuses(azure_configured)`: có đoạn done + failed + waiting_quota → sau khi đổi, chỉ đoạn waiting_quota đổi status; `books.updated_at` không đổi.
   - `test_requeued_chunk_claimable_by_new_provider(azure_configured)`: sau khi đổi, `claim_next_pending(["azure"], ...)` trả về đoạn đó với `voice == "vi-VN-NamMinhNeural"`.
3. **Implement** `set_voice` theo mục Architecture; cập nhật docstring.
4. **Docs**: sửa các dòng đã liệt kê; ghi `docs/project-roadmap.md` 1 dòng bugfix ngày 2026-09-30.
5. **Regression Gate**: `.venv/Scripts/python -m pytest -q` xanh toàn bộ.

## Success Criteria

- [ ] 3 test mới đỏ trước, xanh sau; test cùng provider xanh trước và sau
- [ ] `test_set_voice_keeps_done_audio_and_does_not_touch_updated_at` vẫn xanh
- [ ] Full suite xanh
- [ ] Docs không còn nhắc PATCH là cách đổi giọng khi chờ quota

## Risk Assessment

- Đổi provider qua lại liên tục (gemini → azure → gemini): mỗi lần gỡ đoạn chờ, nhưng worker in-memory vẫn dừng gemini đến `_pause_until` → không đốt thêm lượt gọi. Không bị lặp vô hạn.
- Đoạn đang `processing` lúc đổi: không đụng, xong với giọng cũ (theo quy tắc đoạn đang tạo giữ giọng). Có ghi ở brainstorm.
- Hai request `PUT /voice` cùng lúc: transaction + đọc provider bên trong nên kết quả nhất quán.
- Rollback: revert `book_repository.py` + test + docs.

## Review Follow-up (user approved M1 + L1 + L3 + L4; L2 accepted)

- **M1 (race, reproduced by reviewer):** chunk `processing` on gemini → user switches to azure → gemini 429 → `mark_waiting_quota` parked it on gemini's quota for 1h. Fix: `chunk_repository.mark_waiting_quota` parks only if `chunks.provider IS books.tts_provider`; otherwise → `pending`, `not_before`/`error` NULL. Worker still pauses the old provider in memory. Test: `test_quota_on_old_provider_after_switch_does_not_park_chunk`.
- **L1:** `set_voice` releases `waiting_quota AND provider IS NOT <new provider>` (no SELECT; also frees chunks parked before this fix shipped). Test: `test_set_voice_releases_chunks_parked_on_another_provider`.
- **L2 (accepted):** account quota meter derives "paused" from `waiting_quota` rows, so it stops showing paused early after a release. Display only.
- **L3:** test section comment describes the invariant, not history.
- **L4:** `test_chunk_response_is_404_when_book_vanished_meanwhile`.
- Extra touchpoint: `app/repositories/chunk_repository.py`.
