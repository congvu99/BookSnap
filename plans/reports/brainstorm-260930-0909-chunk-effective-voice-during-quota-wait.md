# Brainstorm: giọng từng đoạn lẫn lộn khi chờ quota

- Ngày: 2026-09-30
- Trạng thái: đã duyệt (A + D)
- Modes: none

## Vấn đề

Đang chờ quota TTS, user đổi giọng cho sách (`PUT /api/books/{id}/voice`) → player sheet "Giọng đọc: …" hiện mỗi đoạn một giọng khác nhau, dù user đã chọn 1 giọng cho tất cả đoạn chưa có audio.

## Root cause (verified từ code)

- `chunks.voice/provider` = snapshot lúc worker claim (`claim_next_pending` copy từ `books`), `app/repositories/chunk_repository.py`.
- `set_voice` chỉ update `books`; `mark_waiting_quota`, `requeue_expired_quota`, `reset_for_retry` không đụng `chunks.voice`.
- Mỗi chu kỳ quota worker chỉ claim 1–2 đoạn (provider bị pause) → đoạn đã claim giữ giọng của lần claim đó; đoạn chưa claim có `voice=NULL`.
- `chunk_out` trả `c.voice` thô mọi status; `reader-view.js:398` hiện `chunk.voice || book.tts_voice` → lẫn lộn.
- Audio thật: re-claim chép lại giọng hiện tại của sách → audio cuối **đúng**. Lỗi chủ yếu ở hiển thị.

Lỗi thật đi kèm:
1. Đổi provider (Gemini → Azure) nhưng đoạn `waiting_quota` vẫn bị giữ đến `not_before` (mặc định 1h) dù provider mới rảnh.
2. Race: đoạn đang `processing` lúc đổi giọng → ra audio giọng cũ. Hiếm, chấp nhận (khớp quy tắc "đoạn đã/đang có audio giữ giọng").

## Phương án đã cân nhắc

| # | Cách | Kết luận |
|---|---|---|
| A | Serializer tính giọng thực tế theo status | **Chọn**: backend 1 nguồn sự thật, không migration, client đã cài vẫn đúng |
| B | Clear `chunks.voice` khi đoạn rời `processing` mà chưa done | Bỏ: `provider` vẫn phải giữ cho `quota_waits` → nửa vời, YAGNI |
| C | Chỉ sửa frontend | Bỏ: logic đặt sai tầng, SW cache giữ bản cũ |
| D | `set_voice` đổi provider → gỡ `waiting_quota` về `pending` | **Chọn**: sửa lỗi thật #1 |

## Giải pháp

**A — `app/api/serializers.py`**
- `chunk_out(c, book)`: `done`/`processing` → `c.voice/c.provider`; `pending`/`waiting_quota`/`failed` → `book.tts_voice/tts_provider`.
- Callers: `books_routes.py:202` (đã có book); `audio_routes.py:30,40` thêm `ctx.books.get(chunk.book_id)`.
- Frontend không đổi.
- Không tính trong SQL repo: worker cần `Chunk.voice` là snapshot thật.

**D — `app/repositories/book_repository.py::set_voice`**
- Transaction: update `books`; nếu provider đổi → `UPDATE chunks SET status='pending', not_before=NULL, error=NULL, updated_at=? WHERE book_id=? AND status='waiting_quota'`.
- Cùng provider → giữ `waiting_quota` (quota tính theo key).
- Không bump `books.updated_at` (giữ grace-period invariant).
- `quota_waits` không cần sửa: sau khi gỡ, không còn chunk chờ theo provider cũ của sách đó.
- Provider mới cũng đang pause: chunk ở `pending`, claim filter bỏ qua, timeline hiện "đang xếp hàng" — chấp nhận.

## Validation

1. Chunk `waiting_quota` claim với Kore → set_voice Orus (cùng Gemini) → API `voice=Orus`, status vẫn `waiting_quota`.
2. Gemini → Azure (`azure_configured`) → chunk `waiting_quota` → `pending`, `not_before=None`.
3. Chunk `done` giữ giọng cũ (`tests/test_voice_change.py:27` vẫn pass).
4. Chunk `processing` trả `c.voice`, không phải giọng sách.
5. `pytest -q` full suite xanh.

## Rủi ro / rollback

- Thấp: không migration, hình dạng API giữ nguyên (chỉ đổi giá trị `voice/provider` cho chunk chưa done).
- Rollback: revert serializers.py, audio_routes.py, book_repository.py.

## Next steps

- `/ck:plan` với report này.

## Câu hỏi còn mở

- Không.
