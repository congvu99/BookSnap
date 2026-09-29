---
phase: 4
title: "Frontend voice picker and book choose step"
status: pending
priority: P2
dependencies: [2, 3]
effort: "M"
---

# Phase 4: Voice picker, bước xác nhận trước khi chụp, bỏ đổi giọng trong cài đặt

## Overview
Thêm component chọn giọng có nghe thử. Mọi đường vào màn camera (tạo sách mới, chọn sách có sẵn, nút "Thêm trang") đều đi qua bước chọn hoặc xác nhận giọng. Player-sheet chỉ còn hiển thị giọng, không đổi được.

## Requirements
- **`VoicePicker`**:
  - Chip gồm nhãn tiếng Việt, tên kỹ thuật nhỏ và nút ▶/■. Thứ tự: default trước, rồi giọng nam, rồi giọng nữ.
  - Provider `configured=false` → chip bị disable, ghi "Chưa cấu hình". <!-- Red Team: provider chưa cấu hình -->
  - Nghe thử: một `Audio` dùng chung. Trong handler của tap, gán `audio.src = voice.preview_url` rồi gọi `audio.play()` **ngay** để giữ user-gesture trên iOS. Không dùng blob hay objectURL. <!-- Red Team: iOS gesture, objectURL revoke -->
    - Lần sau phát nhanh nhờ `Cache-Control: immutable` với URL có `?v=`.
  - Trạng thái chip: `loading` (từ `play()` tới `playing`), `playing`, `error`.
  - Khi `audio.onerror`: gọi `voicesApi.previewError(url)`, là một `fetch` qua `apiFetch` để lấy `error.code`. Map theo code, **không** theo HTTP status: <!-- Red Team: 503 offline -->
    - `tts_quota` → "Hết lượt nghe thử, thử lại sau"
    - `rate_limited` → "Nghe thử nhiều quá, đợi 1 phút"
    - `provider_unavailable` → "Giọng này chưa được cấu hình"
    - `offline` → "Đang ngoại tuyến"
    - còn lại → "Không nghe thử được"
    - 401 được `apiFetch` xử lý như mọi nơi khác.
  - Unmount → `audio.pause()`, bỏ `src`.
- **Sách mới** (bước `choose`): form có thêm `VoicePicker`, mặc định lấy từ `/api/voices`. Gửi `booksApi.create({title, topic, tts_provider, tts_voice})`.
- **Bước `confirm`** (mới) dùng chung cho 2 lối vào: <!-- Red Team: "Thêm trang" bỏ qua picker -->
  1. Chọn sách trong danh sách "Thêm vào sách có sẵn".
  2. Vào `#/capture/{id}` trực tiếp (nút "Thêm trang" ở `book-status-view.js:152`, hoặc deep link).
  - `CaptureView` có `bookId` → `step` khởi đầu là `'confirm'`, không phải `'camera'`.
  - Router key theo bookId (`app.js:114`) → khi chuyển từ `choose` sang sách có sẵn thì đặt `step='confirm'` trước khi đổi hash. Mount lại vẫn vào `confirm`, không hiện 2 lần vì hai lối vào cùng dẫn tới một step.
  - Nội dung màn `confirm`: tên sách, "Mỗi ảnh là 1 trang", `VoicePicker` (mặc định = `book.tts_provider/tts_voice`), nút "Bắt đầu chụp".
  - `!book.can_manage` → picker chỉ đọc, kèm ghi chú "Chỉ người tạo sách đổi được giọng".
  - Chọn giọng khác → cảnh báo: "Các đoạn **chưa có audio** (gồm trang mới) sẽ đọc bằng giọng {X}; các đoạn đã có audio giữ giọng {Y}." <!-- Red Team: lời hứa D8 sai -->
  - "Bắt đầu chụp":
    1. Chuyển sang `camera`.
    2. **Sau khi `cam.start()` thành công** mới gọi `booksApi.setVoice(id, {tts_provider, tts_voice})` nếu giọng đổi. Camera lỗi hoặc user thoát → giọng không bị đổi. <!-- Red Team: PATCH trước camera -->
    3. `setVoice` lỗi → banner trên màn camera, **không cho chụp** cho tới khi user chọn "Thử lại" hoặc "Giữ giọng cũ".
  - Nút có spinner và bị disable khi đang gửi.
- **Player-sheet**: bỏ `<select id="voice-select">`, `pickVoice`, prop `voices`/`onChangeVoice`. Thay bằng dòng chỉ đọc "Giọng đọc hiện tại: {nhãn} ({tên})" và dòng phụ "Đổi giọng khi thêm trang mới".
  - Nhãn lấy từ `voice` của **chunk đang phát** (có sẵn trong chunk response, `serializers.py:87`), fallback về giọng của sách. <!-- Red Team: sách 2 giọng -->
  - Trong `reader-view.js` bỏ: handler đổi giọng (`reader-view.js:266`), `voicesApi.list()` (`:134`), state `voices` (`:46`), prop `voices` (`:409`).
- `api-client.js`: `booksApi.setVoice(id, body)` → `PUT /api/books/{id}/voice`; `voicesApi.previewError(url)`.

## Architecture
- `web/js/voice-labels.js` (thuần):
  - `VOICE_LABELS`: `Charon: 'Nam · trầm, rõ'`, `Orus: 'Nam · chắc'`, `Fenrir: 'Nam · sôi nổi'`, `Puck: 'Nam · tươi'`, `Kore: 'Nữ · chắc'`, `Aoede: 'Nữ · nhẹ'`, `Leda: 'Nữ · trẻ'`, `Zephyr: 'Nữ · sáng'`, `vi-VN-NamMinhNeural: 'Nam · Azure'`, `vi-VN-HoaiMyNeural: 'Nữ · Azure'`. Nhãn chốt sau Gate 0 của phase 1.
  - `voiceLabel(voice)`: fallback tên gốc.
  - `orderVoices(voicesResponse)` → `{provider, voice, label, isDefault, configured, previewUrl}[]`.
  - `previewErrorMessage(code)`.
- `web/js/components/voice-picker.js`: props `{ options, value, onChange, readOnly }`.
- `web/css/voice-picker.css`: dùng token từ `tokens.css`. Touch target ≥44px. Chip có `aria-pressed`, nút ▶ có `aria-label` "Nghe thử giọng {nhãn}".

## Related Code Files
- Create: `web/js/voice-labels.js`, `web/js/components/voice-picker.js`, `web/css/voice-picker.css`, `tests/web/voice-labels.test.mjs`
- Modify: `web/js/views/capture-view.js`, `web/js/components/player-sheet.js`, `web/js/views/reader-view.js`, `web/js/api-client.js`, `web/index.html`, `web/sw.js` (`SHELL_ASSETS`)

## Implementation Steps
1. **Tests Before:** `pytest tests/test_service_worker_assets.py` xanh. Kiểm tra thủ công luồng capture hiện tại (sách mới, sách có sẵn, "Thêm trang").
2. **Tests New (đỏ)** trong `voice-labels.test.mjs`:
   - Nhãn đúng, fallback đúng.
   - `orderVoices`: default đứng đầu, nam trước nữ, giữ cờ `configured`, không trùng lặp.
   - `previewErrorMessage`: map đúng từng code, fallback đúng.
3. **Implement:** voice-labels → VoicePicker → bước `confirm` + create → dọn player-sheet và reader-view → thêm asset vào SW.
4. **Regression Gate:**
   - `node --test "tests/web/**/*.test.mjs"` và `pytest -q`.
   - Thủ công:
     - "Thêm trang" từ màn trạng thái → hiện `confirm`.
     - Đổi giọng rồi từ chối quyền camera → giọng không đổi.
     - Đổi giọng rồi chụp → gọi `PUT voice`.
     - Offline → "Đang ngoại tuyến".
     - Player-sheet không còn mục đổi giọng.

## Success Criteria
- [ ] Mọi lối vào camera đều qua `choose` hoặc `confirm`.
- [ ] Giọng chỉ đổi khi camera đã chạy.
- [ ] Nghe thử phát ngay trong lần tap đầu trên iOS.
- [ ] Không còn code chết của `pickVoice`/`onChangeVoice`/`voices`.

## Risk Assessment
- **Thêm một bước trước camera**, người muốn chụp nhanh phải bấm thêm 1 lần. Đổi lại, lúc nào cũng thấy giọng sẽ đọc.
- **Nhãn giọng chủ quan:** chốt sau Gate 0.
