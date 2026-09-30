---
phase: 3
title: Reader and player sheet wiring
status: completed
priority: P2
effort: 1.5h
dependencies:
  - 1
  - 2
---

# Phase 3: Reader and player sheet wiring

## Overview
Nối hook vào `ReaderView`: đồng bộ với `playerState.playing`, gọi unlock ở mọi điểm play do người dùng bấm, và thêm mục "Nhạc nền" vào `PlayerSheet`.

## Requirements
- Functional:
  - Mục "Nhạc nền" trong PlayerSheet, nằm **ngay sau "Hẹn giờ tắt"**.
  - Chip `Tắt · Mưa · Piano · Lò sưởi · Violin`.
  - Slider âm lượng 0–60%, bước 5%, **ẩn khi `Tắt`**.
  - Lỗi nhạc → dùng lại toast `.reader-toast` hiện có.
- Non-functional:
  - Theo design guideline: dùng lại `.chip`/`.chip-row`, `.player-sheet-section h3`, tokens màu.
  - Slider có `aria-label="Âm lượng nhạc nền"` và `aria-valuetext` dạng "20%".

## Architecture
Các điểm cần nối trong `web/js/views/reader-view.js`:

| Chỗ | Hiện tại | Sau |
|---|---|---|
| Đầu component | — | `const music = useBackgroundMusic(playerState.playing, { onError: showToast })` |
| `onTogglePlay` (2 nơi: ~L318, ~L378) | `() => playlistRef.current.togglePlay()` | `() => { music.unlock(); playlistRef.current.togglePlay(); }` |
| `onPlayFrom` (~L355) | `(seq) => playlistRef.current.loadAt(seq, 0, true)` | thêm `music.unlock();` trước |
| Media Session `onPlay` | giữ nguyên | **không** unlock (không phải gesture). Nếu ctx suspended thì nhạc im, TTS vẫn chạy |
| `<PlayerSheet …>` props | — | `musicTrack`, `musicVolume`, `onSetMusicTrack`, `onSetMusicVolume` |

Sleep timer: không cần sửa. `setSleep` → `playlist.pause()` → `playing=false` → hook fade-out.

Toast: `.reader-toast` hiện đang dùng `bookmarks.message`. Xem cách `use-book-bookmarks.js` đặt/xoá message. Nếu không tái dùng được gọn thì thêm 1 state `musicMessage` với cơ chế tự ẩn giống vậy, **không** viết component toast mới.

`unlock()` trong hook là no-op khi `trackId == null`.

## Related Code Files
- Modify: `web/js/views/reader-view.js` (+~10 dòng)
- Modify: `web/js/components/player-sheet.js` (+~30 dòng; cập nhật JSDoc props)
- Modify: `web/css/reader.css` (style slider `.music-volume`)
- Modify: `web/js/background-music-tracks.js` (chỉnh `gain` theo tai nghe)

## Implementation Steps
1. Import `useBackgroundMusic` + `AMBIENT_TRACKS`; khởi tạo hook trong `ReaderView`.
2. Bọc 3 điểm play do người dùng bấm bằng `music.unlock()`.
3. PlayerSheet: thêm section:
   ```js
   <div class="player-sheet-section">
     <h3>Nhạc nền</h3>
     <div class="chip-row">
       <button class="chip" aria-pressed=${String(musicTrack == null)} onClick=${() => onSetMusicTrack(null)}>Tắt</button>
       ${AMBIENT_TRACKS.map((t) => html`<button class="chip" aria-pressed=${String(musicTrack === t.id)} onClick=${() => onSetMusicTrack(t.id)}>${t.label}</button>`)}
     </div>
     ${musicTrack != null && html`
       <input type="range" class="music-volume" min="0" max="60" step="5"
         value=${Math.round(musicVolume * 100)}
         aria-label="Âm lượng nhạc nền" aria-valuetext=${`${Math.round(musicVolume * 100)}%`}
         onInput=${(e) => onSetMusicVolume(Number(e.currentTarget.value) / 100)} />`}
   </div>
   ```
   Chọn chip khi TTS đang dừng: chỉ lưu và nạp sẵn, **không** tự phát nhạc (theo quyết định Q2: nhạc đi theo TTS).
4. CSS `.music-volume`: rộng 100%, `accent-color: var(--gold-ink)` (hoặc token accent tương ứng trong `tokens.css`), vùng chạm ≥ 44px, có style focus-visible.
5. Nghe thử bằng tai nghe ở 1× và 1.5×: chỉnh `gain` từng bài sao cho ở 20% giọng đọc vẫn rõ.
6. Kiểm thủ công trên Chrome desktop: 8 tiêu chí nghiệm thu trong `plan.md` (trừ phần riêng của iOS).

## Success Criteria
- [ ] Chọn bài → play TTS → nhạc fade-in; pause → fade-out sau khoảng 0.6s + 1s.
- [ ] Chuyển chunk tự động, seek ±15s, bấm next/prev: nhạc không bị ngắt.
- [ ] Sleep timer hết giờ → nhạc tắt cùng TTS.
- [ ] Rời màn đọc (về thư viện) → nhạc tắt ngay, không còn request hay timer.
- [ ] Đổi bài lúc đang phát → crossfade ngắn, không có 2 bài chồng nhau.
- [ ] Đổi URL nhạc sang 404 (dev) → toast, TTS vẫn phát.
- [ ] `reader-view.js` không tăng quá ~15 dòng.

## Risk Assessment
- Toggle play để pause cũng gọi `unlock()`: vô hại (idempotent, chỉ `resume()`).
- iOS: gesture phải gọi `resume()` đồng bộ. Nếu Preact bọc handler thì vẫn đồng bộ (event handler thường), không được đặt `unlock` sau `await`.
- Preact re-render làm tạo lại engine: engine giữ trong `useRef`, tạo trong effect `[]`.
