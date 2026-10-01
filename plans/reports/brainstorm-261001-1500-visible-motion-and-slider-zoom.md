# Brainstorm: Hiệu ứng thấy được + thanh kéo phóng to

Ngày: 2026-10-01 · Trạng thái: **đã duyệt** · Modes: không flag

## Vấn đề (người dùng: "không thấy hiệu ứng gì")

Nguyên nhân đã xác minh:
1. Windows máy dùng thử tắt "Show animations" (`SPI_GETCLIENTAREAANIMATION = False`) → Chrome/Edge báo `prefers-reduced-motion: reduce` → `web/css/app.css:209-211` cắt mọi animation/transition về 0.001ms. Mọi hiệu ứng đợt `b7640c3` bị vô hiệu.
2. Phản hồi kéo quá nhỏ: ray 2px, thumb chỉ scale 1.35 (`web/css/reader.css:60-71`).
3. Service worker cache-first: cần mở lại app 2 lần sau deploy.

## Quyết định

| Hạng mục | Chốt |
|---|---|
| Reduced motion | **A2: luôn bật hiệu ứng**, bỏ kill-switch toàn cục + các khối `prefers-reduced-motion` chặn animation (trade-off: người cần giảm chuyển động không tắt được; chấp nhận vì app gia đình) |
| Thanh kéo (seek mini player, seek màn đĩa than, âm lượng nhạc nền) | Khi chạm/kéo: ray 2px → ~8px, thumb ~1.8×, easing nảy nhẹ; bong bóng giá trị nổi trên thumb (`12:34 / 40:00`, `45%`); thả tay → thu về ~200ms |
| Âm lượng | Nghe thử khi kéo (previewVolume), chốt % khi thả (giữ hành vi hiện tại) |
| Seek | Chỉ tua khi thả (giữ), bong bóng hiện thời gian xem trước |
| Chuyển trang | **C1: View Transitions API** — màn cũ trượt/mờ ra, màn mới trượt vào (đi sâu: từ phải; quay lại: từ trái); fallback CSS fade hiện tại khi không hỗ trợ |

## Thiết kế kỹ thuật

- `RangeSlider` bọc `<input type=range>` trong wrapper `.range-wrap` (cần cho bong bóng): `--fill` điều khiển vị trí bong bóng; prop `bubble: (v) => string`. Trạng thái `is-active` bật ngay `pointerdown` (không đợi `input`) để phóng to tức thì khi chạm.
- Ray dày dùng transition trên `height` của `::-webkit-slider-runnable-track` + thumb `transform: scale()` (WebKit/Blink hỗ trợ transition trên pseudo); Firefox: `::-moz-range-*`.
- View Transitions: bọc cập nhật route trong `document.startViewTransition(() => flushSync/setHash)`; Preact không có flushSync → cập nhật state rồi đợi render (`await new Promise(requestAnimationFrame)`) bên trong callback. Hướng trượt theo độ sâu route (library/bookmarks/account = 0; book/read/capture/profiles = 1). Không chạy transition cho read↔listen (cùng ReaderView) và khi picker overlay.
- Phần tử cố định (bottom nav, mini player) đặt `view-transition-name` riêng để không trượt theo trang.

## Rủi ro

| Risk | L | I | Mitigation |
|---|---|---|---|
| View Transition chụp ảnh màn hình nặng trên máy yếu | L | M | Thời lượng ≤ 280ms; chỉ animate root, không đặt name cho từng thẻ sách |
| Bong bóng tràn mép màn hình ở 0%/100% | M | L | clamp vị trí trong wrapper |
| `startViewTransition` lỗi giữa chừng (hash đổi liên tục) | L | L | `skipTransition()` khi transition cũ chưa xong |
| Bỏ reduced-motion làm người nhạy cảm khó chịu | L | M | Chấp nhận (quyết định chủ app); dễ thêm công tắc sau |

## Nghiệm thu

- Trên máy Windows đang tắt "Show animations": chuyển trang thấy trượt; sheet trượt lên; thanh kéo phóng to.
- Kéo thanh tiến độ: ray to ra, bong bóng hiện thời gian chạy theo ngón tay, audio chỉ tua khi thả.
- Kéo âm lượng: bong bóng %, nghe đổi ngay, localStorage ghi 1 lần khi thả.
- `node --test` + `pytest` xanh; kiểm headless 390px (không giả lập reduced-motion off — phải thấy animation mặc định).
