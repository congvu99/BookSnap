---
phase: 1
title: Backend replace image (TDD)
status: completed
priority: P1
effort: 3-4h
dependencies: []
---

# Phase 1: Backend replace image (TDD)

## Overview
Endpoint `POST /api/pages/{page_id}/image` thay ảnh cho trang `failed`, đưa về `uploaded`, giữ seq. Test viết trước.

## Requirements
- Functional: chỉ trạng thái `failed` (kể cả khi `image_path IS NULL` do hết hạn). Validate ảnh giống `upload_page` (size ≤ `max_upload_bytes`, MIME khai báo khớp magic bytes JPEG/PNG/WebP).
- Non-functional: atomic (1 transaction), không migration, không đổi API cũ, log `page_image_replaced`.

## Architecture
```
POST /api/pages/{id}/image (multipart image)
  → pages.get(id)               404 nếu không có
  → load_book(ctx, page.book_id) (đồng bộ quyền như các route sách)
  → read_validated_image(image, limit) -> (bytes, mime)   # helper tách từ upload_page
  → ghi tmp/{new_id}.{ext}
  → pages.replace_failed_image(id, path, mime) -> (ok, old_path)
       transaction: SELECT status,image_path WHERE id
                    nếu status != 'failed' → (False, None)
                    UPDATE status='uploaded', image_path, image_mime, error=NULL, attempts=0, updated_at
  → không ok: xoá file mới, 409 page_not_replaceable
  → ok: xoá old_path (nếu có), books.touch, worker.wake(), trả page_out
```
Thứ tự claim: `claim_next_uploaded` sắp theo `created_at`. Trang thay ảnh giữ `created_at` cũ nên được OCR trước, đúng ý muốn vì nó là trang đang chặn.

Race: worker chỉ claim `uploaded`, còn `mark_failed`/`mark_ocr_done` có điều kiện `status='ocr_processing'`. Vì vậy điều kiện `status='failed'` trong transaction là đủ.

## Related Code Files
- Create: `tests/test_page_recapture.py`
- Modify: `app/api/pages_routes.py` (helper `read_validated_image`, route mới; `upload_page` dùng helper)
- Modify: `app/repositories/page_repository.py` (`replace_failed_image`)

## Implementation Steps
1. **Test trước** (`tests/test_page_recapture.py`, dùng fixture `alice`/`app`, `ctx_of`, mẫu `FakeOcr`/`_worker` từ `tests/test_worker_resume.py`; tách helper chung sang module test nếu cần import):
   - `test_replace_image_resets_failed_page_keeping_seq`: tạo page qua API, đặt `failed` + `error`, POST ảnh JPEG mới (bytes bắt đầu `\xff\xd8\xff`) → 200, cùng `id`/`seq`, `status=uploaded`, `error=None`; `attempts=0` trong DB; file mới tồn tại, file cũ đã bị xoá.
   - `test_replace_image_works_after_original_expired`: `failed` + `image_path=NULL` → 200.
   - `test_replace_image_rejects_non_failed_page`: `uploaded`/`ocr_done`/`discarded` → 409 `page_not_replaceable`; không để lại file mồ côi trong `tmp_dir`.
   - `test_replace_image_validates_image`: PNG khai báo là JPEG → 415; vượt `max_upload_bytes` → 413.
   - `test_replace_image_unknown_page_404`.
   - `test_recaptured_page_rejoins_chunks_in_order`: p0 failed, p1 `ocr_done` → `chunk_tick` không tạo chunk → thay ảnh p0 → `worker.claim_and_process_page()` với `FakeOcr` map bytes mới → text p0 → `chunk_tick` → chunk text = p0 rồi p1.
2. Chạy test → đỏ.
3. Tách `read_validated_image` trong `pages_routes.py`, refactor `upload_page` dùng nó. Chạy test cũ của upload (`tests/test_books_api.py`, `tests/test_pipeline_end_to_end.py`) → xanh.
4. Thêm `PageRepository.replace_failed_image` theo mẫu transaction của `discard`.
5. Thêm route `POST /pages/{page_id}/image`.
6. Chạy test mới → xanh. Rồi `pytest -q` toàn bộ.

## Success Criteria
- [ ] 6 test mới xanh, toàn bộ suite xanh
- [ ] `upload_page` hành vi không đổi (test cũ xanh)
- [ ] Không có file mồ côi ở nhánh lỗi

## Risk Assessment
- Refactor helper làm đổi thông báo lỗi upload → giữ nguyên mã/thông điệp `ApiError`; có test cũ bảo vệ.
- Kiểm quyền: app gia đình chỉ có 1 tài khoản, nhưng vẫn gọi `load_book` để nhất quán với các route khác.
