---
phase: 1
title: Effective chunk voice in API
status: completed
priority: P2
dependencies: []
---

# Phase 1: Effective chunk voice in API

## Overview

`chunk_out` trả giọng mà đoạn **sẽ** dùng: đoạn đã/đang có audio → giọng của chính đoạn; đoạn chưa có audio → giọng hiện tại của sách. Player sheet ([reader-view.js:398](../../web/js/views/reader-view.js#L398)) đọc `chunk.voice` nên tự hiện đúng, không cần sửa frontend.

## Requirements

- Functional:
  - `done`, `processing` → `c.provider`, `c.voice`
  - `pending`, `waiting_quota`, `failed` → `book.tts_provider`, `book.tts_voice`
  - Áp dụng cho mọi nơi gọi `chunk_out`: danh sách chunks, PATCH chunk, retry chunk.
- Non-functional: hình dạng response giữ nguyên; thêm tối đa 1 query `books` cho mỗi request PATCH/retry.

## Architecture

- Tính ở serializer, **không** tính trong SQL của repo: worker cần `Chunk.voice` là giá trị thật đã chép lúc nhận đoạn (dùng cho `content_hash`, đường dẫn audio, `quota_waits`).
- Hằng `_OWN_VOICE_STATUSES = ("done", "processing")` trong serializers. Hai status này khớp đúng với lúc `claim_next_pending` đã chép giọng và chưa bị reset.

```python
def chunk_out(c: Chunk, book: Book) -> dict:
    own = c.status in _OWN_VOICE_STATUSES
    ...
    "provider": c.provider if own else book.tts_provider,
    "voice": c.voice if own else book.tts_voice,
```

## Related Code Files

- Modify: `app/api/serializers.py` (`chunk_out` thêm tham số `book: Book`, import `Book`)
- Modify: `app/api/books_routes.py:202` (truyền `book` đã load)
- Modify: `app/api/audio_routes.py:30,40` (load `ctx.books.get(chunk.book_id)` rồi truyền vào; bỏ `# type: ignore` nếu có thể bằng cách giữ biến chunk)
- Create: `tests/test_chunk_effective_voice.py`

## Implementation Steps

1. **Tests Before** (phải qua ngay trên code hiện tại):
   - `test_done_chunk_reports_its_own_voice_after_voice_change`: đoạn done giọng Kore, `PUT /voice` Orus → API `voice == "Kore"` (đã có ở `test_voice_change.py:27`, chỉ cần chắc nó vẫn chạy).
   - `test_processing_chunk_reports_claimed_voice`: `insert_chunk` → `claim` (Kore) → `PUT /voice` Orus → API `status == "processing"`, `voice == "Kore"`.
2. **Tests New** (đỏ trên code hiện tại):
   - `test_waiting_quota_chunk_reports_book_voice`: claim (Kore) → `ctx.chunks.mark_waiting_quota(chunk, future, "quota")` → `PUT /voice` Orus → API `voice == "Orus"`, `provider == "gemini"`, status vẫn `waiting_quota`.
   - `test_requeued_chunk_reports_book_voice`: claim (Kore) → `mark_waiting_quota` với `not_before` trong quá khứ → `requeue_expired_quota(now)` → `PUT /voice` Orus → `status == "pending"`, `voice == "Orus"`.
   - `test_never_claimed_chunk_reports_book_voice`: `insert_chunk` (voice NULL) → API `voice == book tts_voice` (hiện trả `None`).
   - `test_failed_chunk_reports_book_voice`: claim → `mark_failed` → `PUT /voice` Orus → `voice == "Orus"`.
   - `test_retry_endpoint_reports_book_voice`: đoạn `failed` (claim Kore) → `PUT /voice` Orus → `POST /api/chunks/{id}/retry` → body `voice == "Orus"`.
   - Helper dùng lại: `create_book`, `insert_done_chunk` (tests/test_books_api.py), `insert_chunk`, `claim` (tests/test_tail_seal.py), `ctx_of` (tests/conftest.py).
3. **Implement**: sửa `chunk_out` + 3 chỗ gọi theo mục Architecture.
4. **Regression Gate**: `.venv/Scripts/python -m pytest -q` xanh toàn bộ.

## Success Criteria

- [ ] 5 test mới đỏ trước khi sửa, xanh sau khi sửa
- [ ] Test done/processing xanh trước và sau
- [ ] Full suite xanh
- [ ] `grep -rn "chunk_out(" app` → mọi chỗ gọi đều truyền `book`

## Risk Assessment

- Client đã cài có thể dựa vào `voice == null` cho đoạn chưa nhận: đã kiểm, `reader-view.js:398` fallback `|| book.tts_voice`, không chỗ nào khác đọc `chunk.voice` → an toàn.
- PATCH/retry thêm 1 query: endpoint gọi tay, không đáng kể.
- Sách bị xóa đúng lúc PATCH/retry → `books.get` trả None: trả 404 `not_found("Không tìm thấy sách")` thay vì crash.
- Rollback: revert 3 file + file test.
