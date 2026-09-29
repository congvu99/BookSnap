---
phase: 6
title: Frontend processing progress view
status: completed
priority: P1
dependencies:
  - 1
  - 5
effort: M
---

# Phase 6: Màn tiến trình xử lý

## Overview
Viết lại `book-status-view`. Màn hình có:
- % tổng.
- Dòng trạng thái đúng với pha thực tế.
- ETA đơn giản.
- Đếm ngược thời gian chờ trang tiếp, kèm nút "Xong rồi, đọc luôn" cho mọi thành viên.
- Nút nghe khi đã có audio.
- Danh sách trang kèm trạng thái.

## Requirements
- **Thanh % tổng:**
  - `overall = 0.3·ocr + 0.7·tts`, trong đó `ocr = pages.done / max(1, pages.total − pages.discarded)` và `tts = chunks.done / chunks.total` (bằng 0 nếu `total = 0`).
  - `state = ready` → 100%.
  - Không bao giờ giảm trong một phiên xem (lưu trong ref).
  - `role="progressbar"`, có `aria-valuenow`.
- **Pha hiện tại** tính bằng `phaseOf(book)` từ **các bộ đếm thô**, không dựa vào `book.state` (vì `book_state` trả `processing` trước cả `failed`/`waiting_quota`, `serializers.py:27-30`). Thứ tự ưu tiên: <!-- Red Team: phaseOf từ counters -->
  1. `pages.failed > 0 || chunks.failed > 0 || pages.blocked_at_seq != null` → `failed`: "Có trang/đoạn lỗi, xem bên dưới".
  2. `chunks.waiting_quota > 0` → `quota`: "Hết lượt Gemini, tự tiếp tục lúc HH:MM" (từ `next_not_before`).
  3. `pages.processing > 0` → `ocr`: "Đang nhận dạng chữ trang {done+1}/{total}…".
  4. `chunks.queued > 0` → `tts`: "Đang chuyển giọng đoạn {done+1}/{total}", kèm " · còn khoảng N phút" nếu có ETA.
  5. `chunks.tail_waiting` → `tail_wait`: "Đang chờ thêm trang… đoạn cuối sẽ đọc sau m:ss". Đếm về 0 thì đổi thành "Sắp đọc đoạn cuối…".
  6. `pages.total === 0` → `empty`.
  7. còn lại → `ready`: "Sách đã sẵn sàng".
- **ETA đơn giản** (không EMA, không reset theo pha): <!-- Red Team: ETA reset không bao giờ hiện -->
  - Lấy mốc `(t0, chunksDone0)` ở lần load đầu.
  - Khi `chunks.done > chunksDone0` → `eta = (chunks.total − done) × (now − t0) / (done − chunksDone0)`.
  - Chỉ hiện ở pha `tts`. Hiển thị "dưới 1 phút" hoặc "khoảng N phút".
- **Nút "Xong rồi, đọc luôn"**: hiện khi `phaseOf === 'tail_wait'` cho **mọi thành viên** (không kiểm `can_manage`). Bấm → `booksApi.sealTail(id)` → spinner → load lại ngay. Lỗi → banner.
- **Nút nghe:** nút "Đọc / Nghe" hiện có (`book-status-view.js:153`) **được sửa, không thêm nút mới**: <!-- Red Team: gộp CTA -->
  - Nhãn "Nghe ngay · {mm} phút đã sẵn sàng" khi đang xử lý, "Đọc / Nghe" khi ready.
  - Đổi href sang `#/listen/{id}`.
  - Điều kiện hiện giữ nguyên (`state === 'ready' || chunks.done > 0`).
- **Khi chuyển sang ready trong phiên:** `StatusToast` "Sách đã sẵn sàng". Không tự điều hướng.
- **Danh sách trang:** mỗi dòng trong `book.page_list` hiện "Trang N" + chip trạng thái: `uploaded` = Đã tải, `ocr_processing` = Đang nhận dạng (có pulse), `ocr_done` = Xong, `failed` = Lỗi, `discarded` = Đã bỏ. Không thu gọn danh sách. Khối trang lỗi và trang thiếu giữ nguyên như hiện tại. <!-- Red Team: bỏ collapse -->
- **Timeline:** bước đang chạy có dot pulse (tắt khi `prefers-reduced-motion`). Không thêm thanh con cho từng bước. <!-- Red Team: bỏ sub-bars -->
- **Polling:** 3s khi `phaseOf ∉ {ready, empty}`. Dừng khi `document.hidden`; khi visible trở lại thì load ngay. Đếm ngược tick 1s độc lập với poll. Riêng pha `quota` thì poll 60s.

## Architecture
- `web/js/processing-progress.js` (thuần):
  - `overallPercent(book, prev = 0)`
  - `phaseOf(book)`
  - `createEta()` → `{ observe(done, total, atMs), remainingMs(atMs) | null }`
  - `formatEta(ms)`, `formatCountdown(sec)`
  - `statusLine(book, { etaMs, countdownSeconds, formatClock })`: `formatClock` được inject để test không phụ thuộc timezone. <!-- Red Team: timezone test -->
  - `libraryLabel(book)` (dùng ở phase 7)
- `web/js/use-visible-polling.js`:
  - `useVisiblePolling(fn, intervalMs, active)`: dùng `setTimeout` tự lên lịch lại, bỏ qua response cũ nhờ request counter, cleanup khi unmount.
  - Thay thế logic `timerRef` hiện tại. Phase 7 dùng lại.
- `api-client.js`: `booksApi.sealTail(id)`.

## Related Code Files
- Create: `web/js/processing-progress.js`, `web/js/use-visible-polling.js`, `tests/web/processing-progress.test.mjs`
- Modify: `web/js/views/book-status-view.js`, `web/js/components/progress-timeline.js`, `web/js/api-client.js`, CSS của status view, `web/sw.js` (`SHELL_ASSETS`)

## Implementation Steps
1. **Tests Before:** kiểm tra thủ công hành vi hiện tại: poll 3s dừng khi hết việc; retry/discard trang lỗi.
2. **Tests New (đỏ):**
   - `overallPercent`: sách rỗng = 0; OCR xong nửa, chưa có chunk = 15; ready = 100; `prev` lớn hơn thì giữ nguyên; trang discarded không tính vào mẫu số.
   - `phaseOf`:
     - Có `failed` kèm tail pending → `failed`.
     - `queued=3` kèm `tail_waiting=false` → `tts`.
     - `queued=0` kèm `tail_waiting=true` → `tail_wait`.
     - Page đang OCR thắng `tts`.
     - `waiting_quota` thắng `ocr`.
   - `createEta`: chưa có tiến triển → `null`; 2 đoạn trong 20s, còn 5 → ≈50s.
   - `formatCountdown(47)` = `"0:47"`; `formatEta` với <60s, 3 phút, 61 phút.
   - `statusLine` cho từng pha, với `formatClock` giả.
3. **Implement.**
4. **Regression Gate:**
   - `node --test "tests/web/**/*.test.mjs"`, `pytest -q`.
   - Thủ công: chụp 3 trang → OCR → TTS kèm ETA → đếm ngược → "Xong rồi, đọc luôn" (thử bằng tài khoản không phải chủ sách) → toast sẵn sàng.

## Success Criteria
- [ ] Không bao giờ báo "đang chờ thêm trang" khi còn đoạn khác đang synth.
- [ ] Lỗi và quota luôn hiện ra, kể cả khi còn tail pending.
- [ ] % không giảm; poll dừng khi tab ẩn.
- [ ] Retry/discard hoạt động như cũ.

## Risk Assessment
- **Worker pause quota chỉ nằm trong memory:** đếm ngược xong mà tail chưa được claim → hiện "Sắp đọc đoạn cuối…" (không sai, chỉ chờ lâu hơn).
- **Upload nền xong sau khi sách đã ready:** sách quay lại trạng thái processing. Nếu view đã dừng poll thì chỉ cập nhật khi quay lại tab. Chấp nhận.
