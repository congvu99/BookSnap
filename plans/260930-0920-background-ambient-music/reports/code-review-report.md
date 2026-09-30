# Code review — nhạc nền (2026-09-30)

Reviewer: code-reviewer subagent. Status: DONE_WITH_CONCERNS → đã xử lý. Không có blocker, không có regression TTS/SW.

## Phát hiện & xử lý

| # | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| 1 | Medium, CONFIRMED | `unlock()` không gọi `_start()`: TTS đã phát sẵn (lock screen/headset sau reload) → nhạc im cho tới khi `playing` đổi | Sửa: `if (this.active) this._start()` cuối `unlock()`. Test "context born running (Chrome)" bắt được mutation |
| 2 | Medium, PLAUSIBLE | iOS có thể chặn `el.play()` gọi ngoài gesture | Sửa: `unlock()` khi TTS đang dừng thì "mồi" element (play ở gain 0 rồi pause) ngay trong tap. Cần xác nhận trên thiết bị |
| 3 | Medium, CONFIRMED | Engine không có test race | Thêm `tests/web/background-music-engine.test.mjs` (14 test, fake Audio/AudioContext/fetch, mock timers) |
| 4 | Minor | `background-music.js` 210 LOC > 200 | Tách `background-music-graph.js`; engine còn 200 |
| 5 | Low, PLAUSIBLE | Graph dựng dở → element phát không qua gain (to hết cỡ) | `createGainGraph` dựng xong hết mới trả về, lỗi thì đóng ctx; engine đánh dấu `unsupported`, không phát |
| 6 | Low, PLAUSIBLE | Toast "không hỗ trợ" lặp mỗi tap | `unsupported` → chỉ báo một lần |
| 7 | Low, CONFIRMED | A→B→A trong lúc fade 450ms tải lại A | `swap` dùng lại file đang nạp nếu `loadedId === track.id` |
| 8 | Low, PLAUSIBLE | Context iOS 'interrupted' → element vẫn decode, tốn pin | `ctx.onstatechange`: không 'running' thì pause element; 'running' lại thì `_start()` |
| 9 | Low, PLAUSIBLE | Seek sang chunk khác mà tải chunk >600ms → nhạc nhỏ đi rồi to lại | Chấp nhận (hiếm, không hỏng). Ghi vào QA |
| 10 | Low | Bài đổi tên để lại entry cũ trong `booksnap-ambient-v1` | Chấp nhận (YAGNI; ít khi đổi bài). Đã ghi quy ước đổi tên file trong `sw.js` + CREDITS |
| 11 | Low, CONFIRMED | `cache.put` không nằm trong `waitUntil` | Sửa: `event.waitUntil(cache.put(...))` |
| 12 | Low | Ghi storage bên trong updater của `setPrefs` | Sửa: dùng `prefsRef`, ghi bên ngoài updater |
| 13 | Low | Đổi bài = fade-out → tải → fade-in, không chồng tiếng (checklist ghi "crossfade") | Đúng ý đồ (không chồng 2 bài); sửa câu chữ trong phase 3 |

## Đã kiểm, không có vấn đề
- Hook đặt trước early return trong reader-view → thứ tự hook ổn định.
- Media Session, sleep timer, bookmarks toast không đổi hành vi.
- SW: đường Range cho chunk audio không đổi; route nhạc nền nằm trước `/api/`; mọi entry trong `SHELL_ASSETS` đều tồn tại; activate giữ đủ 3 cache.
- Race: token + abort, revoke object URL mọi nhánh, `createMediaElementSource` chỉ 1 lần, timer được dọn khi destroy.

## Câu hỏi còn mở (cần thiết bị)
- iOS có cho `play()` trên element đã được "mồi" khi context đang chạy không?
- Play từ lock screen sau khi reload: nhạc chỉ chạy lại ở lần chạm tiếp theo. Chấp nhận?

## Sửa lỗi sau QA iPhone (2026-09-30): "nhạc nền không phát / quá nhỏ"

- **Nguyên nhân chính (user xác nhận):** quá nhỏ. Giọng TTS đo -14..-17 LUFS. Nhạc -23 LUFS × mặc định 0.2 ≈ -37 LUFS (thấp hơn giọng 21 dB); ở mức tối đa 0.6 ≈ -27 LUFS. Sửa: chuẩn hoá lại -18 LUFS (limiter 0.89), mặc định 25% (≈ -30 LUFS, thấp hơn giọng 14 dB), slider 0–100%.
- **Lỗi iOS (tái hiện bằng test):** chọn bài khi TTS đang phát → file tải xong sau lần chạm → `play()` ngoài gesture bị từ chối (`NotAllowedError`, chỉ ghi `console.warn`) → im lặng. Sửa: `_prime()` trong mọi lần chạm, dùng bài đang chọn nếu đã tải, ngược lại dùng clip WAV im lặng 10ms. Khi bị từ chối thì đặt lại cờ để lần chạm sau mồi lại, và hạ gain về 0.
- **Review lần 2:** High: bản mồi đầu tiên có thể phát bài cũ trong lúc đổi bài. Đã sửa: chỉ mồi bằng bài *đang chọn*, bài cũ thì unload. Có test.
- **Cache:** `SHELL_CACHE` v19, `AMBIENT_CACHE` v2 (cùng URL, nội dung mới).
- **Test:** 62/62 JS pass, trong đó có fake mô phỏng chính sách gesture của iOS. Mutation check: bỏ `_prime()` → test fail.
- **Còn mở:** xác nhận trên iPhone thật luồng "đang nghe → chạm chip".
