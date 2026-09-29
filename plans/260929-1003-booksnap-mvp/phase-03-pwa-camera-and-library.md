---
phase: 3
title: "PWA camera và thư viện"
status: in-progress
priority: P1
dependencies: [1]
---

# Phase 3: PWA camera và thư viện

## Overview
App shell PWA theo [design-guidelines](../../docs/design-guidelines.md): đăng nhập/đăng ký, thư viện sách chung, màn chụp nhiều trang trực tiếp bằng camera trình duyệt (ảnh chỉ trong RAM), trạng thái xử lý.

## Requirements
- Functional: đăng ký (username, tên hiển thị, mật khẩu, mã mời) / đăng nhập / đăng xuất; tạo sách mới hoặc thêm trang vào sách có sẵn; chụp liên tiếp, xem thumbnail, xoá/chụp lại trước khi gửi; upload nền kèm retry; xem tiến trình OCR/TTS.
- Non-functional: không ảnh nào ghi vào bộ nhớ thiết bị; ảnh gửi đi ≤ ~800KB (resize cạnh dài 2000px, JPEG q0.85); touch target ≥44px; hoạt động trên Android Chrome + iOS Safari; cần HTTPS (localhost dev ok).

## Architecture

```
web/
  index.html              # app shell, font preload, viewport meta
  manifest.webmanifest    # name BookSnap, theme #7A2E2E, background #FBF7EF, icons SVG/PNG
  sw.js                   # phase 4 bổ sung cache audio; phase 3: cache app shell
  css/tokens.css          # color/space/type tokens (light + dark) từ design-guidelines
  css/app.css
  vendor/preact-htm.module.js   # vendored, không CDN runtime
  js/
    app.js                # router hash-based: #/library, #/capture/:bookId?, #/book/:id
    api-client.js         # fetch wrapper, xử lý 401 → login
    camera-capture.js     # getUserMedia, capture → Blob, torch nếu hỗ trợ
    upload-queue.js       # hàng đợi upload tuần tự, retry backoff, trạng thái từng trang
    views/auth-view.js, library-view.js, capture-view.js, book-status-view.js
    components/book-cover.js, bottom-nav.js, progress-timeline.js
```

**Camera flow:**
```
getUserMedia({video:{facingMode:'environment', width:{ideal:3840}}})
 → <video playsinline muted>
 → tap chụp: drawImage vào OffscreenCanvas/canvas (resize) → toBlob('image/jpeg', .85)
 → thumbnail = URL.createObjectURL(blob) → upload-queue
 → upload thành công: revokeObjectURL, giải phóng blob
```
Dừng stream (`track.stop()`) khi rời màn hình/ẩn tab. Cảnh báo `beforeunload` nếu còn trang chưa upload.

## Related Code Files
- Create: `web/**` như trên
- Modify: `app/main.py` (mount static, `Cache-Control` cho asset, SPA fallback)

## Implementation Steps
1. `tokens.css` chuyển nguyên bảng token + font import (subset vietnamese) từ design-guidelines; dark mode qua `prefers-color-scheme` + toggle.
2. App shell + router (chưa đăng nhập → `#/auth`) + bottom nav 3 mục (Thư viện · Chụp · Đang nghe), icon Lucide SVG inline stroke 1.5.
3. Auth view: màn chào (logo Cormorant) 2 tab **Đăng nhập** · **Đăng ký**; label hiển thị, `autocomplete=username|current-password|new-password`, hiện/ẩn mật khẩu, lỗi ngay dưới ô (sai mã mời, trùng tên, sai mật khẩu); sau thành công → `#/library`. Nút đăng xuất + tên hiển thị trong header thư viện.
<!-- Updated: Brainstorm user accounts - login token → đăng ký/đăng nhập -->
4. Library view (thư viện chung): lưới bìa sinh tự động (Cormorant, viền vàng), tiến độ **của user hiện tại**, "Chụp bởi {display_name}", trạng thái; mục "Tiếp tục nghe" ở đầu (từ `/api/me/continue`); empty state. Chỉ người tạo thấy menu đổi giọng/xoá.
5. Capture view: xin quyền camera (màn giải thích khi bị từ chối), khung hướng dẫn, nút chụp 72px, strip thumbnail, "Xong (n)"; chọn "Sách mới (nhập tên)" hoặc sách có sẵn; phản hồi rung nhẹ (`navigator.vibrate`) khi chụp nếu có.
6. Upload queue: tuần tự, `seq` tăng dần do client cấp, retry 3 lần, trạng thái trên thumbnail.
7. Book status: timeline Tải ảnh → Nhận dạng chữ → Chuyển giọng → Sẵn sàng; poll 3s khi còn việc, dừng khi xong.
8. Manifest + SW app shell (cache-first cho asset, network-first cho API).

## Success Criteria
- [ ] Chụp 5 trang trên Android Chrome và iOS Safari: Thư viện ảnh của máy không có ảnh mới. — *chưa verify: cần thiết bị thật; Playwright fake camera đã chụp + upload OK*
- [ ] Mất mạng giữa lúc upload → trang hiện lỗi, bấm thử lại thành công. — *chưa verify: logic queue dừng ở trang lỗi + retry/bỏ trang đã có; cần test mạng thật*
- [ ] Lighthouse PWA installable; a11y ≥ 90; không horizontal scroll ở 375px. — *chưa verify: chưa chạy Lighthouse*
- [ ] Tương phản đạt AA ở cả light/dark (kiểm bằng devtools). — *chưa verify: token lấy từ design-guidelines đã tính AA; chưa kiểm devtools*

## Risk Assessment
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| iOS PWA standalone hạn chế getUserMedia/torch | M | M | Test sớm trên HTTPS thật (deploy sớm phase 5); torch ẩn nếu không hỗ trợ |
| Ảnh mờ/nghiêng → OCR kém | M | H | Khung hướng dẫn, tap-to-focus nếu hỗ trợ, xem trước thumbnail phóng to trước khi gửi |
| Bộ nhớ khi giữ nhiều blob | L | M | Upload ngay sau chụp, revoke URL; giới hạn 30 trang/phiên |
| Đóng tab khi chưa upload xong → mất trang | M | L | Cảnh báo beforeunload; chấp nhận (ảnh không lưu máy theo yêu cầu) |
