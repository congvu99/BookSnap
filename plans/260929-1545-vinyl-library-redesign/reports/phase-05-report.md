# Phase 5 - Đăng nhập tối ưu iOS: báo cáo

## File đổi
- `web/js/views/auth-view.js` (viết lại view; giữ nguyên logic authApi / ApiError err.field / cacheUser / authStore)
- `web/css/auth.css` (toàn bộ style mới, prefix `signin-`)
- Không đụng library.css / ornaments.css (rule `.auth-*` cũ tự hết tác dụng vì đổi class; xoá ở bước dọn dẹp sau).

## Chi tiết
- Hero: `RecordSleeve` + `VinylDisc` (book `{id:'brand'}` -> palette wine, đã verify bằng node), đĩa trượt 900ms 1 lần, tắt khi reduced-motion. `:focus-within` thu hero (scale .52, ẩn tagline + rule).
- Segmented tablist (role=tab, indicator trượt), form group, nút 52px, footer theo tab.
- Ràng buộc khớp backend (auth_routes.py): username 3-32, password min 6 / max 128 (KHÔNG phải 8 như phase file), display name max 40. `passwordrules="minlength: 6; maxlength: 128;"` chỉ khi đăng ký.
- Autofill attrs đúng spec; enterkeyhint: username/display next, password login=go / register=next, invite=go. Font 17px.
- Eye toggle trong hàng (aria-label + aria-pressed). Lỗi field: `data-error` (vạch đỏ + nhãn đỏ), `<p role=alert>` + icon alert-circle dưới group, input có aria-invalid + aria-describedby. Lỗi chung dùng banner cũ.
- Busy: `VinylDisc spinning`, nút disabled "Đang mở thư viện…", blur input để bàn phím hạ.
- Đổi tab xoá lỗi, giữ giá trị. Form `novalidate` (để backend trả lỗi field); vẫn có `required`, `minlength`, `maxlength`.

## Kiểm thử (server port 8015, agent-browser session p5, 390x844)
- Login screen, register + mã mời sai (lỗi hiện đúng ô Mã mời, aria-describedby ok), focus collapse, dark: OK.
- Register với mã `moi` -> redirect `#/library`: OK.
- eval: username autocapitalize=none, autocomplete=username, 17px; display name words; password new-password + passwordrules; invite off/none.
- pytest: 124 passed (117 + 7 bookmark do main session thêm).
- Server đã tắt, browser session đã đóng.
- Screenshots (scratchpad): `p5-login.png`, `p5-register-error.png`, `p5-focus.png`, `p5-dark.png`.

## Lệch spec / lưu ý
- Password min = 6 theo backend, phase file ghi 8.
- Thêm `padding-top: max(safe-area-top, 12px)` để hero thu nhỏ không dính mép trên khi không có safe-area (browser thường). Chưa chụp lại sau chỉnh này (chỉ đổi 1 dòng padding).
- Chưa test trên iPhone thật (Keychain, bàn phím thật) - cần user kiểm.
- Rule `.auth-*` cũ trong library.css / ornaments.css + `OrnateFrame` `auth-frontispiece` giờ thừa; dọn ở cleanup phase.
- `sw.js` cache list không thuộc phần mình; auth.css đã linked sẵn trong index.html.

Status: DONE_WITH_CONCERNS
Summary: Auth view mới hoàn tất theo mockup, verify trên 390x844 (login, lỗi mã mời, focus collapse, dark, redirect), pytest 124 passed.
Concerns/Blockers: Password min là 6 (backend), không phải 8; chưa test iPhone thật; rule `.auth-*` cũ còn trong library.css/ornaments.css chờ dọn.
