---
phase: 4
title: Web profile picker and shelf
status: completed
priority: P2
effort: 1d
dependencies:
  - 3
---

# Phase 4: Web profile picker and shelf

## Overview
UI kiểu Netflix: màn "Ai đang nghe?", đổi/quản lý hồ sơ, nút + bộ lọc "Kệ của tôi". PWA Preact + htm, không build step; theo `docs/design-guidelines.md`.

## Requirements
- **Auth view [RT#2]:** sau login/register đọc `LoginOut`: `profile_required` → picker; ngược lại `cacheUser(<MeOut fields>)`. Gọi `/api/auth/status`; `registration_open=false` → ẩn tab Đăng ký.
- **Boot [RT#3]:** trong catch của `authApi.me()` ở `app.js`, thêm nhánh `err.status === 409 && code ∈ {profile_required, profile_mismatch}` → xoá `CACHED_USER_KEY`, state `{user: null, needsProfile: true, ready: true, offline: false}` → picker. Chỉ status 0 / 503 offline mới dùng cached user.
- **409 toàn cục:** api-client phát `booksnap:profile-required` cho mọi 409 `profile_required`/`profile_mismatch`, **kể cả** khi `skipAuthRedirect` (chỉ 401 bị gate bởi cờ này).
- **Chống lệch tab [RT#4]:** api-client gửi `X-Profile-Id: <authStore.user.id>` mọi request khi có user. Lắng nghe `storage` event trên `CACHED_USER_KEY` → tab khác reload về thư viện/picker. ReaderView key theo `${user.id}:${bookId}` để `PlaybackProgress` tạo lại khi đổi hồ sơ.
- **Không mất ảnh chụp [RT#10]:** khi nhận event 409 mà upload queue còn ảnh → không unmount màn chụp; hiện thông báo chặn "Hồ sơ đã bị đổi/xoá — chọn hồ sơ để tiếp tục tải ảnh", giữ queue trong bộ nhớ.
- **Picker:** lưới avatar (chữ cái đầu + màu `c1..c8`), "Thêm hồ sơ" (ẩn khi đủ 8), "Quản lý" → sửa tên/màu; xoá: hộp xác nhận nói rõ mất tiến độ/bookmark/kệ, sách chuyển cho hồ sơ tạo sớm nhất, **ô nhập mật khẩu gia đình** [RT#5]; nút xoá ẩn với hồ sơ đang dùng. Picker chỉ gọi endpoint `CurrentAccount`.
- **Menu tài khoản:** "Đổi hồ sơ" → picker.
- **Account view:** hiện tên + avatar hồ sơ và "Tài khoản gia đình: @username"; form đổi mật khẩu ghi rõ "đổi mật khẩu sẽ đăng xuất mọi thiết bị trong nhà".
- **Kệ:** nút thêm/bỏ kệ (thẻ sách hoặc player sheet); bộ lọc "Kệ của tôi" cạnh bộ lọc chủ đề, lọc client-side theo `on_shelf`.
- **Đổi hồ sơ:** giữ cache audio/sách offline và key `booksnap:progress:{profileId}:*`; cập nhật `CACHED_USER_KEY`; reload thư viện + continue listening.
- **Logout [RT#14]:** **giữ** key tiến độ của mọi hồ sơ (1 nhà, thiết bị chung; local có thể là bản duy nhất chưa sync). Chỉ xoá `CACHED_USER_KEY`. Bỏ gọi `clearUserProgress` trong `sign-out.js`.
- Bump `SHELL_CACHE` (`booksnap-shell-v21` → `v22`), thêm file mới vào `SHELL_ASSETS`.

## Architecture
- `web/js/profile-avatar-style.js` (helper thuần): `avatarColor(key)`, `avatarInitial(displayName)` (NFC, hoa, tên tiếng Việt có dấu, rỗng → "?").
- `web/js/components/profile-avatar.js`, `profile-picker-screen.js`, `profile-manage-form.js`.
- `web/js/api-client.js`: `profiles.{list,create,update,remove(id, password),select}`, `shelf.{add,remove}`, `auth.status`; header `X-Profile-Id`; event 409.
- Màu avatar: 8 token trong `web/css` theo tông `sleeve-palette.js`; chữ trắng tương phản ≥ 4.5:1 light/dark.

## Related Code Files
- Create: `web/js/profile-avatar-style.js`, `web/js/components/profile-avatar.js`, `web/js/components/profile-picker-screen.js`, `web/js/components/profile-manage-form.js`, `tests/web/profile-avatar-style.test.mjs`
- Modify: `web/js/views/auth-view.js` [RT#2], `web/js/views/account-view.js` [RT#2], `web/js/views/reader-view.js` (key) [RT#4], capture view chứa upload queue (`web/js/upload-queue.js` + view dùng nó) [RT#10], `web/js/app.js`, `web/js/api-client.js`, `web/js/store.js`, `web/js/sign-out.js`, `web/js/components/library-account-menu.js`, `web/js/components/topic-filter-menu.js` (hoặc thanh lọc thư viện), `web/js/components/record-sleeve.js` hoặc `player-sheet.js` (nút kệ), `web/js/components/account-profile-forms.js`, `web/css/*`, `web/sw.js`
- Optional: `docs/mockups/vinyl-library-preview.html` thêm `?screen=profiles`

## Implementation Steps (TDD)
1. **Test đỏ** `tests/web/profile-avatar-style.test.mjs`: "Đức" → "Đ", "  an " → "A", "" → "?", emoji đầu tên không vỡ; key lạ → `c1`.
2. Nếu tách được logic thuần quyết định state boot (`classifyMeError(err) → 'logged_out' | 'needs_profile' | 'offline'`) → test node cho 401/409/0/503.
3. `tests/test_service_worker_assets.py` tự bắt file thiếu trong `SHELL_ASSETS`.
4. Implement helper → components → wiring.
5. Kiểm tay (skill `run` hoặc trình duyệt):
   - đăng ký mới → vào thẳng; thêm hồ sơ → logout/login → picker;
   - nghe A → đổi B → về A đúng vị trí;
   - 2 tab: tab 2 đổi hồ sơ → tab 1 reload, tiến độ A không ghi vào B;
   - xoá hồ sơ B từ thiết bị khác → B cold boot → picker (không offline);
   - đang chụp dở → hồ sơ bị xoá → ảnh trong queue không mất;
   - kệ; xoá hồ sơ cần mật khẩu; Safari iOS khổ hẹp; dark mode; offline nghe sách đã tải sau khi đổi hồ sơ.

## Success Criteria
- [ ] `node --test "tests/web/**/*.test.mjs"` và `pytest -q` xanh.
- [ ] Acceptance #1, #2, #5, #6 kiểm tay đạt trên Chrome desktop + Safari iOS.
- [ ] Các kịch bản 2 tab / xoá từ xa / chụp dở ở bước 5 đạt.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Client cũ sau deploy | M | M | Response tương thích [RT#2]; bump SW |
| Boot 409 bị coi là offline | M | H | Nhánh 409 riêng [RT#3] |
| Tab ghi nhầm hồ sơ | M | H | `X-Profile-Id` + `storage` event [RT#4] |
| 409 lặp vô hạn | L | M | Picker + audio + voices/usage đều `CurrentAccount` |
