---
phase: 2
title: Backend voice change for new content only
status: completed
priority: P2
dependencies:
  - 1
effort: S
---

# Phase 2: Đổi giọng cho nội dung chưa có audio, validate giọng, chặn chèn SSML

## Overview
Thêm endpoint riêng `PUT /api/books/{id}/voice` để đổi giọng mà không tạo lại audio đã có. Validate voice theo whitelist và theo provider đã cấu hình. Đóng lỗ chèn SSML ở Azure.

## Requirements
- **`PUT /api/books/{id}/voice`**, body `{tts_provider, tts_voice}`, chỉ owner (`ensure_book_owner`). <!-- Red Team: endpoint riêng thay cho cờ regenerate -->
  - Tại sao không dùng cờ `regenerate` trên PATCH: `BookPatchIn` bỏ qua field lạ (`books_routes.py:31-35`). Nếu revert backend trong khi PWA (cache SW) vẫn gửi `regenerate:false`, server cũ sẽ chạy `change_voice` và requeue cả cuốn. Endpoint mới thì server cũ trả 404/405, không gây hại.
  - Nếu voice khác giọng hiện tại → `BookRepository.set_voice(book_id, provider, voice)`: chỉ `UPDATE books SET tts_provider=?, tts_voice=?`, **không** ghi `updated_at` (tránh reset grace và nhảy đếm ngược), không đụng `chunks`. Sau đó `ctx.worker.wake()`. <!-- Red Team: updated_at reset grace -->
  - Trả `_book_detail`.
  - Log `book_voice_set book_id=%s user_id=%s provider=%s voice=%s`.
- **PATCH `/api/books/{id}` giữ nguyên** hành vi `change_voice` (regenerate) cho client cũ. UI mới không gọi nhánh này nữa.
- **Validate** trên `create_book`, `PUT voice` và nhánh voice của PATCH: <!-- Red Team: whitelist + configured -->
  - Voice ngoài whitelist → **400** `unknown_voice` (field `tts_voice`), cùng kiểu lỗi với phần còn lại của API (`books_routes.py:46`, `api_errors.py:37`).
  - Provider chưa cấu hình (key rỗng) → **409** `provider_unavailable`.
  - **Khi implement:** chỉ áp dụng khi chọn provider **khác** `tts_default_provider`. Nếu áp cho cả provider mặc định thì 2 test worker cũ gãy (môi trường test không có key Gemini), và một deploy thiếu key sẽ không tạo được sách nào. Thiếu key ở provider mặc định vốn đã hiện trên màn usage. PATCH chỉ kiểm whitelist, không kiểm configured, để giữ nguyên hành vi cũ.
  - Chỉ validate **input mới**, không validate dữ liệu đã lưu trong DB.
- `/api/voices`: mỗi provider có thêm `configured: bool` (additive).
- **Chặn chèn SSML:** `_build_ssml` ([tts_azure.py:22](../../app/pipeline/tts_azure.py)) đang chèn `voice` thẳng vào attribute `name`. Sửa bằng `xml.sax.saxutils.quoteattr`. Cách này bảo vệ cả các row voice đã lưu từ trước. <!-- Red Team: SSML injection -->

## Architecture
- `app/tts_voices.py`:
  - Chứa `GEMINI_VOICES`, `AZURE_VOICES` (chuyển từ `voices_routes.py:7-8`).
  - `allowed_voices(settings, provider)`: whitelist + default của settings, giống `_with_default` hiện tại.
  - `provider_configured(settings, provider)`: kiểm tra key tương ứng khác rỗng.
- Các module import `tts_voices`: `voices_routes`, `books_routes`, phase 3 và `scripts/voice_poc.py` (dùng làm danh sách mặc định cho `--voices`).
- Không sửa worker. Voice được copy từ book **lúc claim** (`chunk_repository.py:114-116`). Vì vậy:
  - Chunk `done` giữ giọng cũ (`content_hash` không đổi).
  - Mọi chunk **chưa có audio** (pending, waiting_quota, failed rồi retry), kể cả chunk thuộc trang cũ, sẽ dùng giọng mới. Phase 4 phải ghi đúng điều này, không hứa "trang cũ giữ giọng cũ". <!-- Red Team: D8 wording -->

## Related Code Files
- Create: `app/tts_voices.py`
- Modify: `app/api/books_routes.py`, `app/api/voices_routes.py`, `app/repositories/book_repository.py`, `app/pipeline/tts_azure.py`
- Modify tests: `tests/test_books_api.py`, `tests/test_tts_router.py` (hoặc test riêng cho `_build_ssml`)

## Implementation Steps
1. **Tests Before:** các test hiện có phải xanh và không được sửa:
   - `test_patch_title_and_voice_resets_chunks`
   - `test_patch_same_voice_does_not_reset`
   - `test_create_book_with_azure_uses_azure_default_voice`
   - `test_voices_lists_defaults`
   - Lưu ý: test Azure có thể cần set key giả trong settings vì validate "configured". Sửa fixture tối thiểu và ghi rõ lý do.
2. **Tests New (đỏ):**
   - `PUT voice`: chunk `done` giữ `status/voice/audio_path`; `books.tts_voice` đổi; **`updated_at` không đổi**.
   - `PUT voice`: chunk `pending` claim sau đó mang `voice` mới.
   - `PUT voice` non-owner → 403; voice lạ → 400 `unknown_voice`; provider chưa cấu hình → 409.
   - `create_book` với voice lạ → 400; với Azure chưa cấu hình → 409.
   - `/api/voices` có `configured` cho từng provider.
   - `_build_ssml(text, 'x" onload="y')` → attribute được escape, XML parse được và chỉ có một attribute `name`.
3. **Implement.**
4. **Regression Gate:** `pytest -q`.

## Success Criteria
- [ ] PATCH cũ giữ nguyên hành vi.
- [ ] Endpoint mới không requeue chunk `done` và không reset grace.
- [ ] Voice lạ hoặc provider chưa cấu hình không bao giờ tới được worker từ input mới.
- [ ] SSML luôn escape tên voice.

## Risk Assessment
- **Sửa fixture test Azure:** thay đổi nhỏ, phải ghi lý do trong test.
- **Chunk-editor sửa text đoạn đã done** → synth lại bằng giọng hiện tại của sách. Đã ghi nhận, không xử lý ở vòng này.
- **Rollback:** endpoint mới (server cũ trả 404). Escape SSML và validate là thay đổi an toàn.
