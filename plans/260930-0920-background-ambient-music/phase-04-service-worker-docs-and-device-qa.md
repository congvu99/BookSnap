---
phase: 4
title: Service worker docs and device QA
status: in-progress
priority: P2
effort: 1.5h
dependencies:
  - 3
---

# Phase 4: Service worker docs and device QA

## Overview
Thêm route cache nhạc nền trong SW (sống qua các lần deploy), cập nhật precache shell và docs, rồi QA trên iPhone thật.

## Requirements
- Functional:
  - `/audio/ambient/*` đi theo cache-first vào `booksnap-ambient-v1`. **Không** đi qua `cacheFirstShell`.
  - `activate` giữ lại `AMBIENT_CACHE`.
  - 4 file JS mới có trong `SHELL_ASSETS`. Bump `SHELL_CACHE`.
- Non-functional: request có Range header (nếu có) vẫn được trả đúng. Dùng lại `respondWithRange`.

## Architecture
```js
const AMBIENT_CACHE = 'booksnap-ambient-v1';
function isAmbientAudio(url) { return url.pathname.startsWith('/audio/ambient/'); }

async function handleAmbientAudio(request) {
  const cache = await caches.open(AMBIENT_CACHE);
  const cached = await cache.match(request.url);
  const range = request.headers.get('range');
  if (cached) return range ? respondWithRange(cached.clone(), range) : cached;
  try {
    const res = await fetch(request);
    if (res.status === 200) cache.put(request.url, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response('Offline và chưa tải nhạc nền', { status: 503 });
  }
}
```
Gắn vào `fetch` listener **trước** nhánh `cacheFirstShell`. Sửa `activate`: danh sách giữ lại = `[SHELL_CACHE, AUDIO_CACHE, AMBIENT_CACHE]`.

Chỉ `put` khi status 200: Cache API reject 206, giống ghi chú C3 hiện có.

Đổi file nhạc sau này: đổi tên file (vd. `rain-v2.mp3`) thay vì bump `AMBIENT_CACHE`, để không bắt tải lại mọi bài. Cache cũ để lại rác nhỏ, chấp nhận được. Ghi chú điều này trong comment đầu `sw.js`.

## Related Code Files
- Modify: `web/sw.js` (route + activate + `SHELL_ASSETS` + bump `SHELL_CACHE` lên version kế tiếp của giá trị lúc implement)
- Modify: `docs/codebase-summary.md` (4 module mới, thư mục `web/audio/ambient/`, script)
- Modify: `docs/system-architecture.md` (luồng nhạc nền: Web Audio graph, cache `booksnap-ambient-v1`)
- Modify: `docs/design-guidelines.md` (mục "Nhạc nền" trong sheet, slider)
- Modify: `README.md` (1 dòng: thêm bài nhạc nền = `scripts/prepare_ambient_audio.py` + CREDITS; cần ffmpeg)

## Implementation Steps
1. Sửa `sw.js` như trên. Thêm vào `SHELL_ASSETS`: `/js/background-music.js`, `/js/background-music-prefs.js`, `/js/background-music-tracks.js`, `/js/use-background-music.js`.
2. Bump `SHELL_CACHE`. Kiểm lại xem plan `260929-1636` phase 8 đã bump chưa, để tránh trùng version.
3. Chạy `.venv\Scripts\python -m pytest -q` + `node --test "tests/web/**/*.test.mjs"`.
4. Kiểm trên Chrome desktop:
   - DevTools → Application → Cache Storage có `booksnap-ambient-v1` chứa bài đã phát.
   - Bật Offline → phát lại được.
   - Bump `SHELL_CACHE` giả, reload → `booksnap-ambient-v1` vẫn còn.
5. QA thiết bị (bản deploy Railway, HTTPS). Ghi kết quả vào `reports/device-qa-report.md`:

   | # | Kịch bản | iPhone Safari | iPhone PWA đã cài | Android Chrome |
   |---|---|---|---|---|
   | 1 | Slider đổi âm lượng thật sự | | | |
   | 2 | Nút gạt im lặng bật → vẫn nghe nhạc + TTS | | | |
   | 3 | Khoá màn hình 2 phút → nhạc + TTS vẫn chạy | | | |
   | 4 | Pause/Play từ lock screen → cả hai theo | | | |
   | 5 | Lock screen "Now Playing" hiện tên sách (không phải nhạc) | | | |
   | 6 | Chế độ máy bay sau khi đã phát 1 lần | | | |
   | 7 | Sleep timer 10 phút → cả hai tắt | | | |
   | 8 | Cuộc gọi đến / Siri cắt ngang → quay lại app, bấm play → cả hai tiếp | | | |

6. Cập nhật docs.

## Success Criteria
- [ ] Toàn bộ test pass.
- [ ] Cache nhạc sống qua bump `SHELL_CACHE`.
- [ ] Offline phát được bài đã phát trước đó.
- [ ] Bảng QA điền đủ; kịch bản 1, 5, 6, 7 pass trên iPhone. Kịch bản 2, 3, 4 fail thì ghi rõ phiên bản iOS và hành vi, rồi hỏi user (câu hỏi mở trong `plan.md`).
- [ ] Docs khớp với code.

## Risk Assessment
- Kịch bản 3/4 fail trên iOS < 17.5 (bug WebKit suspend AudioContext khi chạy nền đã được sửa ở 17.5). Chấp nhận: TTS không bị ảnh hưởng, ghi vào docs.
- Kịch bản 5: iOS có thể lấy `<audio>` nhạc làm "Now Playing". Giảm thiểu: metadata Media Session đã được set. Nếu vẫn sai thì báo user, không tự đổi kiến trúc.
- SW cũ trên máy người dùng chưa có route mới → mp3 bị lưu vào `SHELL_CACHE` một lần. Tự hết sau khi SW mới activate.
