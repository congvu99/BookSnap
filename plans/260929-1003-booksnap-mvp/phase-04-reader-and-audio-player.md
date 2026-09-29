---
phase: 4
title: "Reader và audio player"
status: in-progress
priority: P1
dependencies: [1, 2]
---

# Phase 4: Reader và audio player

## Overview
Màn đọc + nghe: văn bản Literata, highlight đoạn đang phát, phát liên tục qua các chunk, nhớ vị trí, điều khiển màn hình khoá, tải về nghe offline, sửa text đoạn.

## Requirements
- Functional: play/pause, ±15s, tốc độ 0.75–2×, thanh tiến độ toàn sách; chạm đoạn → phát từ đó; tự cuộn theo đoạn (tắt khi user tự kéo, có nút "Về đoạn đang đọc"); nhớ vị trí (local + server); Media Session; hẹn giờ tắt; cỡ chữ 16–24px; "Tải để nghe offline"; sửa text đoạn → sinh lại audio.
- Non-functional: chuyển đoạn gap < 300ms (preload đoạn kế); tôn trọng `prefers-reduced-motion`; `aria-current` cho đoạn đang đọc.

## Architecture

```
web/js/
  audio-playlist.js       # 1 <audio> chính + 1 <audio> preload; queue theo chunk.seq; events → store
  playback-progress.js    # lưu {chunk_seq, offset_ms} vào localStorage (key theo `user_id` + `book_id`) mỗi 5s + PUT server (debounce 15s, khi pause/ẩn tab)
  media-session.js        # metadata (tên sách, bìa SVG), actions play/pause/seek/next/prev
  offline-audio-cache.js  # Cache API 'booksnap-audio-v1': tải toàn bộ chunk của sách, báo dung lượng
  views/reader-view.js
  components/mini-player.js, player-sheet.js, chunk-paragraph.js, chunk-editor.js
web/sw.js                 # route /api/chunks/*/audio: cache-first nếu đã tải; hỗ trợ Range từ cache
```

**Thời gian toàn sách:** tổng `duration_ms` các chunk → vị trí tuyệt đối = Σ duration trước + offset hiện tại. Chunk chưa có audio: hiển thị trạng thái, player dừng ở đó và tự tiếp tục khi chunk xong (poll).

**Range từ cache trong SW:** Safari yêu cầu 206 cho `<audio>`; SW phải cắt `ArrayBuffer` theo header `Range` khi trả từ Cache API.

## Related Code Files
- Create: các file trên
- Modify: `web/sw.js`, `web/js/app.js` (route `#/book/:id`), `web/js/components/bottom-nav.js` (tab "Đang nghe" → sách nghe gần nhất **của user**, từ `/api/me/continue`)

## Implementation Steps
1. Reader layout: max-width 38rem, đoạn là `<p>` có `data-seq`; highlight `--highlight` transition 200ms.
2. `audio-playlist.js`: load chunk n, preload n+1 khi còn 10s; `ended` → next; `playbackRate` giữ nguyên qua các đoạn.
3. Auto-scroll: `scrollIntoView({block:'center'})` khi đổi đoạn, tạm tắt 8s sau khi user scroll tay.
4. Mini player dính đáy (safe-area) + sheet mở rộng (chương/tốc độ/hẹn giờ/cỡ chữ/theme).
5. Progress theo user: khôi phục khi mở sách — ưu tiên bản mới hơn giữa local và server; đăng xuất xoá progress local của user đó. Offline audio cache dùng chung giữa các user trên cùng máy (audio giống nhau).
<!-- Updated: Brainstorm user accounts - progress theo user -->
6. Media Session + test nghe khi khoá màn hình (Android/iOS).
7. Offline: nút tải, tiến độ tải, dung lượng; SW trả Range từ cache; `navigator.storage.persist()`.
8. Chunk editor: long-press/menu đoạn → sửa text → PATCH → trạng thái "đang sinh lại".
9. Trạng thái đoạn `waiting_quota`: icon đồng hồ + "Chờ quota, tiếp tục lúc HH:mm"; player dừng ở đó và tự tiếp khi có audio. Sheet cài đặt sách: đổi giọng (cảnh báo sẽ sinh lại cả sách).
<!-- Updated: Validation Session 1 - thay badge giọng dự phòng bằng trạng thái waiting_quota -->

## Success Criteria
*Đã implement đủ; mọi tiêu chí dưới cần audio TTS thật + thiết bị thật (xem checklist trong `reports/phase-03-04-web-implementation-report.md`).*
- [ ] Nghe liên tục 10 đoạn không ngắt thủ công; highlight khớp đoạn.
- [ ] Kill app giữa chừng → mở lại đúng đoạn, sai lệch ≤ 5s.
- [ ] 2 user trên 2 máy nghe cùng sách → mỗi người tiếp tục đúng vị trí riêng.
- [ ] Chế độ máy bay: sách đã tải phát được cả trên iOS Safari (kiểm Range 206 từ SW).
- [ ] Nút tai nghe/màn hình khoá điều khiển được play/pause/next.
- [ ] Sửa text 1 đoạn → audio mới thay thế, các đoạn khác không đổi.

## Risk Assessment
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| iOS dừng audio khi chuyển `src` lúc khoá màn hình | M | H | Test sớm; phương án B: 2 phần tử audio luân phiên; phương án C (sau MVP): server ghép MP3 theo chương |
| SW Range handling sai → Safari không phát offline | M | M | Test riêng; fallback tải blob → `URL.createObjectURL` |
| Trình duyệt xoá Cache API khi đầy bộ nhớ | L | M | `storage.persist()`; hiển thị trạng thái đã tải/chưa |
