---
phase: 1
title: "Backend tail waiting seal tail and default voice"
status: pending
priority: P1
dependencies: []
effort: "M"
---

# Phase 1: Gate PoC giọng, trạng thái chờ đoạn cuối, seal-tail, giọng mặc định Charon

## Overview
Trước khi viết code, nghe thử Charon đọc tiếng Việt (gate). Sau đó:
- API cho client biết chính xác lúc nào **chỉ còn** đoạn cuối đang chờ grace, và còn bao lâu.
- Mọi thành viên bỏ qua được thời gian chờ.
- Sửa race khiến text sửa tay bị mất.
- Đổi giọng mặc định sang Charon.

## Requirements
- **Gate 0: PoC giọng (chặn cả phase)** <!-- Red Team: PoC lên đầu -->
  - `scripts/voice_poc.py` nhận `--voices Charon,Orus,Kore` và `--style "<text>"` qua CLI, không lấy từ `.env`.
  - User nghe Charon/Orus/Kore với style **hiện tại** (và tùy chọn thêm một biến thể "trầm").
  - Charon không đạt → dừng, hỏi user chọn giọng khác. Default, nhãn và test trong các phase sau dùng tên giọng đã chốt.
  - **✅ Kết quả 2026-09-29:** đã nghe Charon, Orus, Kore (style hiện tại) và Charon với style "trầm". User chốt **Charon + style hiện tại**. Script đã có `--text/--voices/--style/--tag` và tự bỏ qua Azure khi chưa có key.
- **Style prompt giữ nguyên** `"Đọc bằng giọng kể chuyện ấm áp, chậm rãi, truyền cảm:"`. <!-- Red Team: style global đổi chất giọng đoạn mới của sách Kore cũ -->
  - Lý do: style gửi kèm mọi lần synth (`tts_gemini.py:35`) nhưng không nằm trong `content_hash`. Đổi style sẽ làm các đoạn mới của sách Kore cũ đọc khác đi.
  - Độ trầm đến từ bản thân giọng Charon. Chỉ đổi style nếu PoC cho thấy cần, và phải hỏi user trước.
- `gemini_tts_voice = "Charon"` (hoặc giọng chốt ở gate).
- **Trường mới trong `chunks`** (additive, cả `GET /api/books` lẫn `GET /api/books/{id}`): <!-- Red Team: tail_waiting mơ hồ -->
  - `queued: int`: số chunk `pending|processing` **không phải** tail unsealed. Nghĩa là số đoạn còn phải synth, không tính đoạn cuối đang chờ.
  - `tail_waiting: bool` = có tail `pending AND sealed=0` **và** `pages_processing == 0` **và** `queued == 0`.
- **Chỉ trong `GET /api/books/{id}`** (`_book_detail`), để `book_out` giữ nguyên chữ ký:
  - `chunks.tail_wait_seconds: int | null` = `max(0, ceil(updated_at + grace − now_server))` khi `tail_waiting`, còn lại là `null`.
  - Client đếm ngược từ lúc nhận response, không phụ thuộc đồng hồ máy.
  - Bỏ `tail_ready_at` vì trùng thông tin với `tail_wait_seconds`. <!-- Red Team: bỏ trùng -->
- `POST /api/books/{id}/seal-tail`: **mọi user đã đăng nhập** (cùng mức quyền với upload/discard/retry ở `pages_routes.py:43,74,89`). Trả 204, idempotent, gọi `ctx.worker.wake()`. Sách không tồn tại → 404. <!-- Red Team: quyết định của user, mọi thành viên -->
- Log: `book_tail_sealed book_id=%s user_id=%s rows=%d`.

## Architecture
- `_SUMMARY_SQL` ([book_repository.py](../../app/repositories/book_repository.py)), trong subquery `cs` thêm:
  - `SUM(status='pending' AND sealed=0) AS tail_pending`
  - `SUM(status IN ('pending','processing') AND NOT (status='pending' AND sealed=0)) AS queued`
  - Thêm 2 field tương ứng vào `BookSummary`. `book_out` ([serializers.py](../../app/api/serializers.py)) đọc 2 field này.
  - 3 call site của `book_out` (`books_routes.py:73,82,87`) không đổi.
- `ChunkRepository.seal_tail(book_id) -> int`: `UPDATE chunks SET sealed=1, updated_at=? WHERE book_id=? AND status='pending' AND sealed=0`.
- **Race đã kiểm chứng:** `replace_tail` xoá tail bằng `DELETE ... WHERE id=? AND status='pending'` (`chunk_repository.py:85`), không kiểm `sealed`. Có hai kịch bản:
  1. Chunker đọc tail → user seal → `replace_tail` xoá chunk đã seal rồi ghi lại tail unsealed. Kết quả: thao tác seal bị bỏ qua.
  2. **Mất dữ liệu có thật ngay hôm nay:** chunker đọc tail → user sửa text (`update_text` ở `chunk_repository.py:46-52`, gọi từ `audio_routes.py:28`, đặt `sealed=1`) → `replace_tail` ghi đè text user vừa sửa. <!-- Red Team: chunk edit race -->
  - **Sửa:** `DELETE ... AND status='pending' AND sealed=0`. Khi rowcount = 0 → `TailBusyError` → tick sau `get_unsealed_tail` trả `None` → trang mới vào chunk mới (invariant D-3, docstring [worker.py](../../app/pipeline/worker.py)).
  - Cập nhật docstring của `TailBusyError`: tail còn có thể bị user seal hoặc sửa, không chỉ bị TTS claim.
- `book_state` giữ nguyên. Client **không** suy ra pha từ `state` (xem phase 6).

## Related Code Files
- Modify: `scripts/voice_poc.py`, `app/config.py`, `app/repositories/book_repository.py`, `app/repositories/chunk_repository.py`, `app/api/serializers.py`, `app/api/books_routes.py`
- Modify/Create tests: `tests/test_books_api.py`, `tests/test_tail_seal.py`

## Implementation Steps
1. **Gate 0:** sửa `voice_poc.py` (CLI voices/style), chạy với key thật, user nghe và chốt giọng.
2. **Tests Before:** `pytest -q` làm baseline. Khóa hành vi hiện tại: tail `sealed=0` không được claim trước grace, và được claim sau grace.
3. **Tests New (đỏ):**
   - Sách rỗng hoặc mọi chunk done → `tail_waiting=False`, `queued=0`.
   - Có 3 chunk sealed pending + tail unsealed, không page nào đang OCR → `queued=3`, `tail_waiting=False`.
   - Chỉ còn tail pending unsealed → `tail_waiting=True`, `0 ≤ tail_wait_seconds ≤ grace`.
   - Còn page `uploaded` → `tail_waiting=False`.
   - `seal-tail`: owner → 204; **non-owner → 204**; gọi lần 2 → 204; sách không tồn tại → 404; chưa đăng nhập → 401.
   - Sau seal-tail, worker (grace = 3600s) claim được tail **ngay**.
   - Sau seal-tail, upload + OCR thêm trang → nội dung mới vào seq mới; text chunk cũ không đổi.
   - Race seal: gọi `get_unsealed_tail` → `seal_tail` → `replace_tail(tail cũ)` → raise `TailBusyError`, chunk còn nguyên.
   - Race sửa text: `get_unsealed_tail` → `update_text` → `replace_tail(tail cũ)` → raise `TailBusyError`, text đã sửa còn nguyên.
   - Sách mới không truyền voice → `tts_voice == <giọng chốt>`.
4. **Implement.**
5. **Regression Gate:** `pytest -q` xanh toàn bộ.

## Success Criteria
- [ ] Giọng mặc định đã được user nghe và duyệt trước khi code.
- [ ] `tail_waiting` chỉ `True` khi không còn đoạn nào khác phải synth.
- [ ] Text sửa tay không bao giờ bị chunker ghi đè.
- [ ] Không mất field nào trong response cũ.

## Risk Assessment
- **Seal khi người khác còn đang chụp:** chỉ làm đoạn bị tách sớm (ranh giới chunk). Không mất và không đảo chữ. User đã chấp nhận.
- **Provider đang pause quota trong worker** (chỉ lưu trong memory, `worker.py:289`): đếm ngược về 0 nhưng tail chưa được claim. Phase 6 hiển thị "Sắp đọc đoạn cuối…" chứ không báo sai. Không chia sẻ trạng thái pause ở vòng này.
- **Rollback:** field additive + endpoint mới + guard SQL. Revert commit là đủ; client cũ gọi `seal-tail` trên server cũ sẽ nhận 404/405, không gây hại.
