# Phase 3 — Chế độ Đang nghe của ReaderView

## Context
`web/js/views/reader-view.js` (356 dòng) sở hữu `AudioPlaylist`, `PlaybackProgress`, media session, sleep timer, polling. `web/js/app.js` route `read`. `web/js/components/mini-player.js`, `player-sheet.js`.

## Requirements
- Route `#/listen/:id` → `{ name: 'read', bookId, mode: 'listen' }`; `app.js` render cùng `ReaderView` cùng `key=bookId` ở cùng vị trí → không remount. `NO_NAV_ROUTES` gồm cả listen.
- `mode='listen'`: ẩn nội dung đọc + mini player, hiện `NowPlayingPanel`:
  - Sân khấu: vỏ trái, đĩa (`detailed`) trượt ra khi `playing` (translateX 54.9%, 700ms), xoay; cần đĩa SVG đồng thau, góc `playing ? 9.5 + p*20 : -6` (p = vị trí tuyệt đối / tổng thời lượng).
  - Eyebrow "Mặt A · Đoạn n/N", tên, "Chụp bởi", trích đoạn đang đọc (2 dòng, italic Literata).
  - Seek (range hình thoi hiện có), thời gian tabular, ±15s, Play 68px, hàng chip: tốc độ (vòng qua RATES), Hẹn giờ (mở sheet), Đọc cùng (→ `#/read/:id`), Đánh dấu (phase 4 — để placeholder ẩn).
- `mode='read'`: topbar thêm nút đĩa → `#/listen/:id`; mini player: vỏ 48px + đĩa nhỏ xoay khi phát.
- Tab "Đang nghe" trong bottom nav → `#/listen/:continueId`.
- Không tự phát khi mở màn (giữ nguyên hành vi hiện tại).

## Files
- Create: `web/js/components/now-playing-panel.js`, `web/js/components/tonearm.js`, `web/css/now-playing.css`
- Modify: `web/js/app.js` (parseRoute), `web/js/views/reader-view.js` (prop `mode`, chuyển render; tách nếu cần để < ~360 dòng — không thêm logic player mới), `web/js/components/mini-player.js`, `web/js/components/bottom-nav.js`, `web/index.html`

## Steps
1. parseRoute + render chung.
2. `NowPlayingPanel` nhận props từ state hiện có (`playerState`, absolute ms, handlers) — không tạo playlist mới.
3. Mini player art; nút đĩa topbar.
4. Kiểm chuyển mode khi đang phát.

## Validation
- Đang phát ở read → bấm nút đĩa → vẫn phát, thời gian liên tục; ngược lại qua "Đọc cùng".
- Back của trình duyệt giữa 2 mode không ngắt nhạc.
- Reduced motion: không slide, không xoay, cần đĩa nhảy thẳng tới vị trí.

## Risks
| Rủi ro | Giảm thiểu |
|---|---|
| Remount do khác vị trí vnode | 1 nhánh `case 'read'` duy nhất, truyền `mode` |
| Auto-scroll reader chạy khi ở listen | Tắt effect auto-scroll khi `mode !== 'read'` |
