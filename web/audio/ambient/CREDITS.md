# Nhạc nền — nguồn & giấy phép

Tất cả file được xử lý bằng `scripts/prepare_ambient_audio.py`:
- Chuẩn hoá về -18 LUFS bằng gain tuyến tính + limiter -1 dBFS (giọng TTS khoảng -16 LUFS; mặc định 100% ≈ thấp hơn giọng ~2 dB).
- Encode MP3 128 kbps, 44.1 kHz, stereo. Metadata gốc bị bỏ.
- Bài loop (mưa, lửa): crossfade đuôi vào đầu để lặp lại liền mạch.
- Bài nhạc: fade-in 2s, fade-out 3s.

Chỉnh sửa (cắt, ghép, chuẩn hoá âm lượng) do BookSnap thực hiện; tác giả gốc không xác nhận hay bảo trợ bản chỉnh sửa này.

| File | Tác phẩm | Tác giả / biểu diễn | Nguồn | Giấy phép | Chỉnh sửa |
|---|---|---|---|---|---|
| `rain.mp3` | "rain on leaves" + "rain drops" | Gravity Sound | [Rain on leaves](https://commons.wikimedia.org/wiki/File:Rain_on_leaves_(Gravity_Sound).wav), [Rain drops](https://commons.wikimedia.org/wiki/File:Rain_drops_(Gravity_Sound).wav) (Wikimedia Commons) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Ghép 2 bản (crossfade 6s), loop 4s, chuẩn hoá |
| `piano.mp3` | Erik Satie — *Gymnopédie No. 1* (Lent et douloureux) | Robin Alciatore (Musopen) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg) | Public domain | Fade, chuẩn hoá |
| `fireplace-cafe.mp3` | "Campfire sound ambience" | Glaneur de sons (Freesound) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Campfire_sound_ambience.ogg) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Nén dải động (compressor 4:1), loop 3s, chuẩn hoá |
| `violin.mp3` | Jules Massenet — *Méditation* (Thaïs) | Bomsori Kim (violin), Pallavi Mahidhara (piano); Premiere Performances of Hong Kong | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Meditation_from_Thais_-_Bomsori_Kim.opus) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Fade, chuẩn hoá |

## Thêm / thay bài

1. Tải file nguồn vào `scripts/ambient-source/<id>.<ext>` (thư mục này bị gitignore). Chỉ dùng PD, CC0 hoặc CC BY. Ghi nguồn và giấy phép vào bảng trên.
2. Khai báo bài trong `TRACKS` (`scripts/prepare_ambient_audio.py`) và trong `AMBIENT_TRACKS` (`web/js/background-music-tracks.js`).
3. Chạy `python scripts/prepare_ambient_audio.py <id>`. Cần ffmpeg trên PATH hoặc gói `imageio-ffmpeg`.
4. Nếu thay nội dung một bài đã phát hành, **đổi tên file** (vd. `rain-v2.mp3`), vì service worker cache nhạc nền theo URL.
