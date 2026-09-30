# Brainstorm: Nhạc nền song song khi nghe sách

- Ngày: 2026-09-30
- Trạng thái: **Đã duyệt thiết kế** → chuyển `/ck:plan`
- Modes: không (không `--html`, `--wiki`)

## 1. Vấn đề & yêu cầu

Người dùng muốn phát nhạc nền (thư thái, tập trung) song song với giọng đọc TTS trong reader/listen mode.

Vấn đề gốc: nghe TTS lâu đơn điệu, khoảng lặng giữa chunk (<300ms) "hụt"; muốn không khí dễ chịu hơn. Nhạc nền là giải pháp hợp lý, miễn là không làm giảm độ rõ giọng đọc.

Quyết định đã chốt với user:

| # | Quyết định | Chọn |
|---|---|---|
| Q1 | Nguồn âm thanh | File loop đóng gói trong repo (không stream ngoài, không noise tự sinh) |
| Q2 | Đồng bộ | Nhạc **dừng theo TTS** (pause, sleep timer, hết sách, chờ chunk) |
| Q3 | Danh sách | Tiếng mưa, Piano ambient nhẹ, Lò sưởi/quán café, **Violin cổ điển du dương** |
| Q4 | Lưu cài đặt | Theo thiết bị, `localStorage` (không đổi backend) |
| Q5 | Bản quyền | App cá nhân/phi thương mại; vẫn ưu tiên bản thu PD/CC (Musopen, Wikimedia Commons, Pixabay) vì web/ serve công khai và repo có thể public |

## 2. Bối cảnh codebase

- PWA không build step (Preact + htm). Phát audio 100% client: [audio-playlist.js](../../web/js/audio-playlist.js) — 2 `<audio>` luân phiên theo chunk.
- [reader-view.js](../../web/js/views/reader-view.js) (411 LOC) giữ vòng đời playlist, sleep timer, Media Session, progress flush.
- [player-sheet.js](../../web/js/components/player-sheet.js) chứa control: tốc độ, hẹn giờ, cỡ chữ, tải offline. Pattern pref: `localStorage` (`booksnap:fontSize`).
- [sw.js](../../web/sw.js): shell precache tường minh + `SHELL_CACHE` version; audio chunk cache riêng với Range 206.
- Không có backlog/plan nào trước đó về nhạc nền.

## 3. Phương án đã đánh giá

### Nguồn âm thanh

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| A. File loop đóng gói | Âm thanh thật, dễ thêm bài | 1–4MB/bài, cần credit | **Chọn** |
| B. Noise tự sinh Web Audio | 0KB, không bản quyền, gapless | Chỉ noise, "mưa" giả kém | Bỏ (user không chọn) |
| C. Stream ngoài (YouTube/radio) | Kho vô hạn | ToS, CORS, không offline | Loại |
| D. Trộn nhạc vào MP3 TTS ở server | — | Bake-in, không tắt được, tốn quota TTS | Loại |

### Cách phát

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| `<audio>` thuần, chỉnh `volume` | Đơn giản | **iOS Safari: `volume` read-only** → nhạc to bằng giọng | Loại |
| `AudioBufferSourceNode` loop | Gapless | Bài 4 phút stereo decode ~85MB RAM → iOS kill tab | Loại |
| `<audio loop>` → `MediaElementAudioSourceNode` → `GainNode` | Âm lượng chỉnh được trên iOS, RAM thấp | Khoảng lặng nhỏ ở điểm lặp lại | **Chọn** |

### Nạp file

| Phương án | Kết luận |
|---|---|
| Qua SW, trả Range 206 như chunk audio | Loại: nhân đôi logic Range phức tạp |
| Tự làm cache-first bằng Cache API (`booksnap-ambient-v1`) → Blob → `createObjectURL` | **Chọn**: không cần Range, offline sau lần phát đầu, ~4MB RAM/bài |

## 4. Giải pháp cuối

### Kiến trúc
- `BackgroundMusic` (module mới): 1 `AudioContext` lazy, 1 `<audio loop>` + `MediaElementSource` + `GainNode`.
- API: `unlock()`, `setTrack(id|null)`, `setVolume(0..1)`, `setActive(bool)`, `destroy()`.
- Gain hiệu dụng = `volume × track.gain`, fade 1s qua `linearRampToValueAtTime`.
- `setActive(false)` chờ **600ms** mới fade-out, vì `playing` có thể nhấp nháy khi chuyển chunk hoặc tải lại.
- Reader-view: effect theo `playerState.playing` → `setActive`. Gọi `unlock()` **đồng bộ** trong handler play/chip (chính sách autoplay). Gọi `destroy()` khi unmount.
- Sleep timer: không cần xử lý riêng. Timer pause TTS → `playing=false` → nhạc fade-out.
- Media Session: giữ nguyên cho TTS. Web Audio không đăng ký session.
- `navigator.audioSession.type = 'playback'` khi có (Safari 17+) để giảm bị suspend nền và bị nút gạt im lặng tắt tiếng.
- Lỗi fetch/decode/play nhạc: bắt lỗi, toast nhẹ, **không bao giờ ảnh hưởng TTS**.

### Asset
- 4 bài, MP3 128kbps stereo, 3–5 phút, tổng ~15MB, **không precache**.
- Chuẩn hoá âm lượng: `ffmpeg -af loudnorm=I=-23:TP=-2:LRA=11`. Mưa/café cắt sao cho điểm lặp lại khớp nhau.
- Violin: bản chậm, êm (Bach *Air on the G String*, Massenet *Méditation*, Elgar *Salut d'amour*); `gain` ~0.6 vì giai điệu tranh dải trung với giọng đọc.
- `web/audio/ambient/CREDITS.md`: nguồn, tác giả, license từng file.

### Files

| File | Thay đổi |
|---|---|
| `web/js/background-music.js` (mới, ~120 LOC) | Class `BackgroundMusic` |
| `web/js/background-music-tracks.js` (mới) | Danh sách bài `{id, label, url, gain, credit}` |
| `web/audio/ambient/{rain,piano,fireplace-cafe,violin}.mp3` + `CREDITS.md` | Asset |
| `web/js/views/reader-view.js` | Nối vào ~15 dòng (tạo instance, effect, unlock, destroy) |
| `web/js/components/player-sheet.js` | Mục "Nhạc nền": chip `Tắt/Mưa/Piano/Lò sưởi/Violin` + slider 0–60% (mặc định 20%) |
| `web/css/reader.css` (hoặc css của player sheet) | Style slider theo tokens hiện có |
| `web/sw.js` | Thêm 2 JS vào `SHELL_ASSETS`, bump `SHELL_CACHE` |
| `tests/web/background-music-*.test.mjs` | Helper thuần: chờ khi pause, volume × gain, đọc/ghi pref khi dữ liệu hỏng |
| `docs/codebase-summary.md`, `docs/design-guidelines.md` | Cập nhật ngắn |

Pref key: `booksnap:bgMusic` = `{ track: string|null, volume: number }`. Mọi truy cập bọc try/catch, dữ liệu hỏng thì về mặc định `{track:null, volume:0.2}`.

## 5. Tiêu chí nghiệm thu

1. Chọn bài rồi play TTS → nhạc fade-in ~1s. Pause, sleep timer hết giờ, hết sách → nhạc fade-out rồi dừng.
2. Chuyển chunk, seek ±15s: nhạc không giật hay dừng. Chờ chunk `waiting_quota` → nhạc dừng, tự chạy lại khi TTS chạy lại.
3. Slider có tác dụng trên **iPhone Safari**. Giọng đọc rõ ở mức mặc định 20%.
4. Reload/mở sách khác: giữ bài và âm lượng.
5. Sau lần phát đầu: chế độ máy bay vẫn phát được bài đó.
6. Rời màn đọc thì nhạc tắt. Nút trên màn hình khoá vẫn điều khiển TTS.
7. File nhạc 404/hỏng: TTS vẫn chạy, có toast nhẹ.
8. `Tắt` → không fetch file nào, không tạo `AudioContext`.

## 6. Ngoài phạm vi

Đồng bộ pref theo tài khoản; upload nhạc riêng; stream ngoài; nhạc theo từng sách; trộn nhiều lớp âm; ducking động; playlist nhiều bản violin; noise tự sinh.

## 7. Rủi ro

| Rủi ro | Khả năng | Giảm thiểu / chấp nhận |
|---|---|---|
| iOS khoá màn hình → Web Audio bị suspend | Trung bình | `audioSession.type='playback'`. Nếu vẫn bị: chấp nhận nhạc dừng khi khoá màn hình, TTS vẫn chạy |
| Nút gạt im lặng tắt tiếng Web Audio | Trung bình | Như trên |
| Play từ màn hình khoá không tính là thao tác người dùng → `ctx.resume()` thất bại | Trung bình | Nhạc chạy lại ở lần chạm tiếp theo trong app; TTS không bị ảnh hưởng |
| Khoảng lặng ở điểm lặp lại của `<audio loop>` | Thấp | Chọn bài dài, cắt điểm lặp lại khớp nhau |
| Violin làm giảm độ hiểu nội dung | Trung bình | Gain 0.6, bản chậm; user tự chọn |
| Đồng thời 3 `<audio>` (2 TTS + 1 nhạc) trên iOS gây "now playing" lẫn lộn | Thấp | Test trên máy thật; metadata Media Session do app set |
| Repo public + file tĩnh công khai → phân phối lại bản thu | Thấp | Chỉ dùng bản thu PD/CC, ghi CREDITS |

## 8. Kiểm chứng

- `node --test "tests/web/**/*.test.mjs"` cho helper.
- Test tay: Chrome desktop, Android Chrome, **iPhone Safari + PWA đã cài** (bắt buộc: slider, khoá màn hình, nút gạt im lặng, chế độ máy bay).
- Mockup `docs/mockups/vinyl-library-preview.html?screen=listen&playing=1` để xem UI mục mới (nếu mockup dùng chung component).

## 9. Bước tiếp theo

1. `/ck:plan` với report này.
2. Tìm và tải asset (Musopen/Wikimedia/Pixabay), chuẩn hoá bằng ffmpeg, ghi CREDITS.
3. Code module + nối UI, rồi test trên máy thật.

> **Cập nhật khi lập plan** ([plan](../260930-0920-background-ambient-music/plan.md)): cache nhạc do **SW** giữ (`booksnap-ambient-v1`, route riêng `/audio/ambient/*`, không bị xoá ở `activate`) thay vì module tự dùng Cache API, vì `cacheFirstShell` hiện tự `put` mọi GET cùng origin vào `SHELL_CACHE` và `activate` xoá các cache lạ. Module chỉ `fetch` → Blob → `createObjectURL`. Mockup vinyl là HTML độc lập, không dùng `PlayerSheet` → ngoài phạm vi.

## Câu hỏi còn mở
- Nếu test cho thấy nhạc luôn bị suspend khi khoá màn hình trên iOS: chấp nhận, hay mở lại phương án (vd. trộn nhạc vào `<audio>` thứ 3 không qua Web Audio và chịu không chỉnh được volume trên iOS)?
