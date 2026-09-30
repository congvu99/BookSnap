---
title: Nhạc nền song song khi nghe sách
description: >-
  Phát nhạc nền (mưa, piano, lò sưởi/café, violin) song song TTS qua Web Audio
  GainNode; dừng theo TTS; pref theo thiết bị
status: in-progress
priority: P2
branch: main
tags:
  - web
  - audio
  - pwa
blockedBy: []
blocks: []
created: '2026-09-30T02:12:37.101Z'
createdBy: 'ck:plan'
source: skill
---

# Nhạc nền song song khi nghe sách

## Overview

Người dùng chọn 1 bài nhạc nền trong PlayerSheet. Nhạc fade-in khi TTS phát và fade-out khi TTS dừng (pause, sleep timer, hết sách, chờ chunk). Âm lượng chỉnh qua `GainNode` để có tác dụng trên iOS. Tuỳ chọn lưu `localStorage` theo thiết bị. **Không đổi backend.**

Nguồn quyết định: [brainstorm report](../reports/brainstorm-260930-0910-background-ambient-music.md).

## Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| D1 | File loop đóng gói trong `web/audio/ambient/`, MP3 128kbps, 3–5 phút, đã chuẩn hoá -23 LUFS | Âm thanh thật; một slider dùng được cho mọi bài |
| D2 | `<audio loop>` → `MediaElementAudioSourceNode` → `GainNode` → destination | iOS bỏ qua `HTMLMediaElement.volume`; `AudioBuffer` 4 phút ~85MB RAM |
| D3 | Nạp file bằng `fetch()` full GET → Blob → `createObjectURL` | Tránh Range 206 (không `cache.put` được); SW cache được response 200 |
| D4 | SW route riêng `/audio/ambient/*` → cache-first `booksnap-ambient-v1`, **giữ lại khi activate** | `cacheFirstShell` hiện tự put vào `SHELL_CACHE` → mất mỗi lần bump version; `activate` xoá mọi cache lạ |
| D5 | `setActive(false)` chờ 600ms rồi fade 1s rồi `el.pause()`; `setActive(true)` huỷ timer chờ | `playing` nhấp nháy khi chuyển chunk; pause thật để tiết kiệm pin |
| D6 | `navigator.audioSession.type='playback'` trước khi tạo `AudioContext`; `AudioContext` tạo lazy + `resume()` đồng bộ trong gesture | Silent switch + chạy nền iOS 17.5+ |
| D7 | Hook `useBackgroundMusic(playing)` (giống `use-book-bookmarks.js`) | reader-view đã 411 LOC; chỉ nối ~8 dòng |
| D8 | Lỗi nhạc không bao giờ ném ra ngoài/ảnh hưởng TTS | Nhạc là phụ |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Ambient audio assets](./phase-01-ambient-audio-assets.md) | Completed |
| 2 | [Background music module](./phase-02-background-music-module.md) | Completed |
| 3 | [Reader and player sheet wiring](./phase-03-reader-and-player-sheet-wiring.md) | Completed |
| 4 | [Service worker docs and device QA](./phase-04-service-worker-docs-and-device-qa.md) | In Progress |

Thứ tự: 1 → 2 → 3 → 4. Phase 2 có thể bắt đầu song song với 1 (dùng file mp3 tạm bất kỳ), nhưng phase 3 cần asset thật để chỉnh `gain`.

## Acceptance criteria (toàn plan)

1. Chọn bài + play TTS → nhạc fade-in ~1s; pause / sleep timer / hết sách → fade-out rồi `pause()`.
2. Chuyển chunk, seek ±15s: nhạc không giật. Chunk `waiting_quota` → nhạc dừng, tự tiếp khi TTS tiếp.
3. Slider có tác dụng trên iPhone Safari; giọng đọc rõ ở mức mặc định 20%.
4. Reload/mở sách khác → giữ bài + âm lượng (`booksnap:bgMusic`).
5. Sau lần phát đầu, chế độ máy bay vẫn phát bài đó; deploy mới (bump `SHELL_CACHE`) không xoá cache nhạc.
6. Rời màn đọc → nhạc tắt; lock-screen controls vẫn điều khiển TTS.
7. File 404/hỏng → TTS vẫn chạy, toast nhẹ.
8. Track `Tắt` → không fetch file nào, không tạo `AudioContext`.

## Ngoài phạm vi

Đồng bộ pref theo tài khoản, upload nhạc, stream ngoài, nhạc theo sách, trộn nhiều lớp, ducking động, playlist violin, noise tự sinh, cập nhật mockup `docs/mockups/vinyl-library-preview.html` (mockup độc lập, không dùng `PlayerSheet`).

## Dependencies

- Không blockedBy. Xung đột mềm: [260929-1636-smart-progress-and-voice-picker](../260929-1636-smart-progress-and-voice-picker/plan.md) phase 8 (in progress) cũng bump `SHELL_CACHE` trong `web/sw.js` → khi implement, lấy version kế tiếp của giá trị hiện có tại thời điểm đó (hiện `v17` → `v18`).
- Dev tool: `ffmpeg` (chưa cài trên máy dev) — chỉ cần cho phase 1.

## Câu hỏi còn mở

- Nếu QA cho thấy iOS vẫn suspend nhạc khi khoá màn hình dù đã đặt `audioSession`: chấp nhận (TTS vẫn chạy) hay mở lại phương án?
