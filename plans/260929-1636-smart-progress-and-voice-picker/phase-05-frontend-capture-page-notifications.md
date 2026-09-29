---
phase: 5
title: "Frontend capture page notifications"
status: pending
priority: P2
dependencies: [4]
effort: "S"
---

# Phase 5: Báo số trang khi chụp và upload

## Overview
Mỗi ảnh là 1 trang (1 `seq`, logic hiện tại đã như vậy). User luôn biết mình đang chụp trang nào và trang nào đã tải lên xong.

## Requirements
- Thumbnail có badge "Trang {seq+1}".
- Mỗi lần có item chuyển sang `done` → toast "Đã tải trang N ✓". <!-- Red Team: cắt gom toast 800ms và rung thêm -->
  - Toast mới **thay** toast cũ; nếu có nhiều trang xong trong cùng một lần emit thì ghi "Đã tải trang 4–6 ✓".
  - Tự ẩn sau 2.5s, `role="status" aria-live="polite"`.
  - **Không** rung thêm, vì `capture()` đã rung sau mỗi lần chụp (`capture-view.js:118`).
- Trang lỗi: nhãn trên thumbnail "Trang N lỗi, chạm để thử lại". Toast lỗi chỉ hiện đến khi user retry hoặc xoá trang đó.
- Topbar: dòng chính "Chụp trang {next}", dòng phụ "Đã tải {done}/{total}".
- Hộp confirm của `finish()` ghi rõ số trang: "Còn trang 5, 6 chưa tải xong…".
- Gợi ý "Mỗi ảnh là 1 trang" đã nằm trong màn `confirm` (phase 4), không lặp lại trên camera.

## Architecture
- `web/js/upload-notices.js` (thuần):
  - `newlyDone(prevDoneIds: Set<string>, items) -> number[]`
  - `formatPageList(seqs) -> string`: nhận seq 0-based, trả chuỗi 1-based, gom dải liên tiếp.
  - `pendingPages(items) -> number[]`
- `capture-view.js`: `useRef(new Set())` lưu các uploadId đã done; `useEffect([items])` tạo message; timer ẩn toast được clear khi unmount.
- Toast: component `web/js/components/status-toast.js` (props `{message, tone}`). CSS **dùng lại** kiểu `.reader-toast` hiện có (`bookmarks.css:41-42`): đổi selector thành `.reader-toast, .status-toast` hoặc chuyển rule sang `app.css`. Không tạo bộ style mới. Phase 6 dùng lại component này.
- Không sửa `upload-queue.js`.

## Related Code Files
- Create: `web/js/upload-notices.js`, `web/js/components/status-toast.js`, `tests/web/upload-notices.test.mjs`
- Modify: `web/js/views/capture-view.js`, `web/css/camera.css`, `web/css/bookmarks.css` (hoặc `app.css`), `web/sw.js` (`SHELL_ASSETS`)

## Implementation Steps
1. **Tests Before:** chạy thủ công luồng chụp hiện tại (3 ảnh, 1 ảnh lỗi mạng) để làm mốc so sánh.
2. **Tests New (đỏ):**
   - `newlyDone`: bỏ qua item đã done từ trước và item có trạng thái khác `done`.
   - `formatPageList`: `[0]→"1"`, `[3,4,5]→"4–6"`, `[3,5]→"4, 6"`, `[0,1,3]→"1–2, 4"`, đầu vào chưa sắp xếp thì sắp xếp trước, `[]→""`.
   - `pendingPages`.
3. **Implement.**
4. **Regression Gate:** `node --test "tests/web/**/*.test.mjs"`, `pytest -q`. Thủ công với DevTools "Slow 3G".

## Success Criteria
- [ ] Mỗi trang upload xong đều được báo đúng số, không trang nào bị báo 2 lần.
- [ ] Trang lỗi hiện rõ số trang.
- [ ] Không có timer rò rỉ.

## Risk Assessment
- **`reassignSeq` khi xung đột seq:** nhãn "Trang N" đổi theo `item.seq` hiện tại. Chấp nhận.
