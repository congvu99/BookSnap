---
phase: 7
title: Frontend library live progress
status: completed
priority: P3
dependencies:
  - 6
effort: S
---

# Phase 7: Thư viện tự cập nhật tiến độ

## Overview
Trên trang chủ, sách đang xử lý có thanh tiến độ và nhãn theo pha, tự cập nhật. Không thêm animation mới. <!-- Red Team: bỏ just-ready animation -->

## Requirements
- Có ít nhất một sách đang ở pha `ocr | tts | tail_wait` (theo `phaseOf`), tab đang visible và không offline → poll `booksApi.list()` mỗi 5s.
- Chỉ còn sách ở pha `quota` → poll 60s. Không còn sách nào đang xử lý → dừng. <!-- Red Team: polling quota hàng giờ -->
- Mỗi lần poll cũng làm mới `continueListening`, vì hero có thể là sách đang xử lý (`list_in_progress_for_user` không lọc theo state, `book_repository.py:130-135`). Gọi song song với list. <!-- Red Team: hero stale -->
- Record của sách đang xử lý:
  - Thanh tiến độ ép đĩa với class **`.rec-build-progress`** (khác `.rec-progress` là thanh tiến độ nghe ở `library-crate.js:44`), giá trị lấy từ `overallPercent`, clamp theo `Map<bookId, %>`. <!-- Red Team: class collision -->
  - Nhãn từ `libraryLabel(book)`:
    - `ocr` → "Đang đọc chữ · x/y trang"
    - `tts` → "Đang ép đĩa · x/y"
    - `tail_wait` → "Chờ thêm trang"
    - `quota` → "Chờ lượt Gemini"
    - `failed` → "Có lỗi"
- Khi sách ready, đĩa tự hiện theo logic sẵn có (`library-crate.js:38`), không cần animation riêng.
- Lỗi mạng khi poll: giữ dữ liệu cũ, không hiện banner, thử lại ở nhịp sau.

## Architecture
- `library-view.js`: `useVisiblePolling(refresh, interval, active && !isOffline)`. `refresh` chỉ gọi `setBooks`/`setContinuing`, không đụng `error`/`isOffline`.
- **Rebase lên WIP account/usage** (đã sửa `library-view.js`) sau khi WIP được commit.
- `library-crate.js`: thay `stateInfo` bằng `libraryLabel`, thêm phần tử `.rec-build-progress`.

## Related Code Files
- Modify: `web/js/views/library-view.js`, `web/js/components/library-crate.js`, `web/css/library.css`
- Modify tests: `tests/web/processing-progress.test.mjs` (case cho `libraryLabel`)

## Implementation Steps
1. **Tests Before:** kiểm tra thủ công tìm kiếm, lọc chủ đề và offline fallback.
2. **Tests New (đỏ):** `libraryLabel` cho từng pha.
3. **Implement.**
4. **Regression Gate:** `node --test`, `pytest -q`. Thủ công: mở 2 tab, tab thư viện tự cập nhật; ẩn tab thì không còn request.

## Success Criteria
- [ ] Không poll khi không có sách đang xử lý, khi tab ẩn hoặc offline; chỉ còn quota thì poll 60s.
- [ ] Tìm kiếm và bộ lọc không bị reset khi dữ liệu làm mới.
- [ ] Không trùng class với thanh tiến độ nghe.

## Risk Assessment
- **Re-render mỗi 5s:** số sách ít, đã có `useMemo`.
- **Xung đột merge với WIP:** precondition là commit WIP trước.
