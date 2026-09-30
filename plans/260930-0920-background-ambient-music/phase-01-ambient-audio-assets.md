---
phase: 1
title: Ambient audio assets
status: completed
priority: P2
effort: 1.5h
dependencies: []
---

# Phase 1: Ambient audio assets

## Overview
Tìm, tải, chuẩn hoá và commit 4 file nhạc nền kèm credit/license. Viết thêm 1 script nhỏ để khi thêm bài mới thì chuẩn hoá lại được.

## Requirements
- Functional: 4 file `web/audio/ambient/{rain,piano,fireplace-cafe,violin}.mp3`.
- Non-functional:
  - MP3 CBR 128kbps, 44.1kHz stereo, 3–5 phút/bài, tổng ≤ 20MB.
  - Integrated loudness -23 LUFS ±1, true peak ≤ -2 dBTP.
  - Không có vocal. Violin chậm, êm.
- License: chỉ PD / CC0 / CC-BY / Pixabay Content License. CC-BY thì ghi credit đầy đủ.

## Architecture
Asset tĩnh, FastAPI serve qua `StaticFiles` mount `/` (`app/main.py:126`) → URL `/audio/ambient/<id>.mp3`. **Không** precache.

Nguồn gợi ý:

| Bài | Nguồn ưu tiên | Ghi chú |
|---|---|---|
| rain | Wikimedia Commons (category "Rain sounds"), Pixabay Sound Effects | Mưa đều, không sấm |
| piano | Wikimedia Commons / Musopen (Satie *Gymnopédie No.1*, Debussy *Rêverie*) | Bản thu PD/CC |
| fireplace-cafe | Pixabay / Commons "fireplace crackling" | Chọn 1 trong 2; không có tiếng người nói rõ |
| violin | Musopen / Commons: Bach *Air on the G String*, Massenet *Méditation*, Elgar *Salut d'amour* | Nếu bản thu có orchestra thì vẫn được, miễn là êm |

Nếu không tải tự động được (vd. Pixabay yêu cầu đăng nhập) → dừng, báo user đặt file nguồn vào `scripts/ambient-source/` (gitignored) rồi chạy script.

## Related Code Files
- Create: `web/audio/ambient/rain.mp3`, `piano.mp3`, `fireplace-cafe.mp3`, `violin.mp3`
- Create: `web/audio/ambient/CREDITS.md` (bảng: file, tên tác phẩm, người biểu diễn/tác giả, nguồn URL, license, đã cắt/chuẩn hoá thế nào)
- Create: `scripts/prepare_ambient_audio.py` (~60 LOC)
- Modify: `.gitignore` (thêm `scripts/ambient-source/`)

## Implementation Steps
1. Cài ffmpeg cho máy dev: `winget install Gyan.FFmpeg` (không thêm vào requirements; đây là tool build asset, không phải dependency runtime).
2. Tìm và tải file nguồn vào `scripts/ambient-source/<id>.<ext>`, ghi lại URL + license ngay khi tải.
3. Viết `scripts/prepare_ambient_audio.py`:
   - Input: `scripts/ambient-source/*`; output `web/audio/ambient/<stem>.mp3`.
   - Tìm `ffmpeg` trên PATH (`shutil.which`); không có → thoát mã 1 và in hướng dẫn cài.
   - Lệnh cho mỗi file: `ffmpeg -y -i <src> -t <max 300s> -af "afade=t=in:d=2,loudnorm=I=-23:TP=-2:LRA=11" -ar 44100 -ac 2 -c:a libmp3lame -b:a 128k <dst>`. Với bài ambient loop (rain, fireplace-cafe): **bỏ afade** để điểm lặp lại không bị hụt; nếu vẫn nghe thấy chỗ nối thì cắt tay tại điểm zero-crossing (ghi chú trong script, không tự động hoá).
   - Kiểm lại: chạy `ffmpeg -i <dst> -af ebur128 -f null -` và in ra loudness đo được; lệch quá ±1 LU so với -23 thì cảnh báo.
   - `subprocess.run(check=True)`; lỗi của từng file thì in tên file và exit ≠ 0, không nuốt lỗi.
4. Chạy script, nghe lại từng file (đặc biệt điểm nối khi loop), kiểm tổng dung lượng.
5. Viết `CREDITS.md`.

## Success Criteria
- [ ] 4 file tồn tại, mỗi file ≤ 6MB, tổng ≤ 20MB.
- [ ] Loudness đo được -23 ±1 LUFS.
- [ ] `CREDITS.md` có đủ nguồn + license cho cả 4 file.
- [ ] Loop rain/fireplace-cafe không có tiếng "cụp" rõ ở điểm nối.
- [ ] Không commit file nguồn thô.

## Risk Assessment
- Nguồn cần đăng nhập → không tự động được. Giảm thiểu: fallback user cung cấp file (bước 2).
- License mơ hồ (bản thu "PD" không rõ ràng) → loại, chọn file khác.
- Repo nặng thêm ~15MB vĩnh viễn trong git history. Chấp nhận (4 file, hiếm khi đổi). Nếu sau này thay bài nhiều → cân nhắc Git LFS.
