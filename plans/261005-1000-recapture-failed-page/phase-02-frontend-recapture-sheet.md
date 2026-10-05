---
phase: 2
title: Frontend recapture sheet
status: completed
priority: P1
effort: 3-4h
dependencies:
  - 1
---

# Phase 2: Frontend recapture sheet

## Overview
Nút **Chụp lại** trên hàng trang Lỗi → sheet "Chụp lại Trang N" có 2 lựa chọn: camera gốc và chọn file. Ảnh được nén JPEG (cạnh dài ≤ 2000px, q0.85) rồi gửi lên endpoint mới.

## Requirements
- Functional: chỉ hiện ở trang `status==='failed'`. Thành công thì toast "Đang nhận dạng lại trang N" và tải lại trạng thái sách. Lỗi 409/413/415 hiện `message` từ server.
- Non-functional: không build step (Preact + htm vendored), theo `docs/design-guidelines.md`, nút có `aria-busy` như `Thử lại`/`Bỏ trang`.

## Architecture
- `web/js/image-downscale.js` (mới, module thuần): `downscaleToJpeg(source: CanvasImageSource, w, h) -> Promise<Blob>` cộng hằng `LONG_EDGE=2000`, `JPEG_QUALITY=0.85`. Logic OffscreenCanvas/fallback canvas chuyển từ `camera-capture.js`. Thêm `fileToJpeg(file: File) -> Promise<Blob>` (dùng `createImageBitmap`, fallback `<img>` + objectURL).
- `camera-capture.js#captureFrame` gọi `downscaleToJpeg(videoEl, vw, vh)` (DRY, hành vi không đổi).
- `api-client.js`: `pagesApi.replaceImage(pageId, blob)` dùng FormData `image`.
- `book-status-view.js`: nút `Chụp lại` (icon `camera`) và state `recapturing: Set<pageId>`. Sheet dùng component sheet sẵn có (theo mẫu `page-picker-sheet.js`) với 2 `<label>` bọc `<input type=file hidden>`:
  - "Chụp ảnh": `accept="image/*" capture="environment"`
  - "Chọn từ máy": `accept="image/*"`
  - onChange → `fileToJpeg` → `replaceImage` → reset input value.

## Related Code Files
- Create: `web/js/image-downscale.js`, `tests/web/image-downscale.test.mjs` (phần tính kích thước thuần, vd. `fitLongEdge(w,h,max)`)
- Create (nếu file view vượt ~200 dòng): `web/js/components/recapture-page-sheet.js`
- Modify: `web/js/camera-capture.js`, `web/js/api-client.js`, `web/js/views/book-status-view.js`, CSS liên quan (nếu cần)

## Implementation Steps
1. Test trước: `tests/web/image-downscale.test.mjs` cho `fitLongEdge` (ảnh nhỏ giữ nguyên; ảnh 4000x3000 → 2000x1500; ảnh dọc).
2. Tạo `image-downscale.js`, chuyển logic từ `camera-capture.js`, cập nhật `captureFrame`.
3. Thêm `pagesApi.replaceImage`.
4. Tạo `recapture-page-sheet.js` (props: `seq`, `onPick(file)`, `onClose`). Gắn vào hàng failed trong `book-status-view.js`.
5. Xử lý lỗi `fileToJpeg` (decode thất bại, vd. HEIC trên trình duyệt không hỗ trợ) → toast "Không đọc được ảnh này, hãy chụp lại".
6. Thêm `image-downscale.js` và component mới vào danh sách asset của `web/sw.js` nếu SW precache theo danh sách (`tests/test_service_worker_assets.py` sẽ bắt lỗi thiếu).

## Success Criteria
- [ ] Node test xanh
- [ ] Camera trong `capture-view` vẫn chụp/nén như cũ
- [ ] Chụp lại thành công → chip trang chuyển `Đã tải` → `Đang nhận dạng` → `Xong`, cảnh báo "đang chặn" biến mất

## Risk Assessment
- iOS Safari < 16.4 không có OffscreenCanvas → đã có fallback canvas (giữ nguyên comment M4).
- HEIC: iOS Safari tự chuyển sang JPEG khi chọn qua `<input>`. Các trình duyệt khác có thể decode thất bại → báo lỗi rõ ràng, không gửi file.
- `capture="environment"` trên desktop bị bỏ qua và mở hộp chọn file → chấp nhận được.
