# Phase 5 — Đăng nhập tối ưu iOS

## Context
`web/js/views/auth-view.js`, `.auth-*` trong `web/css/library.css` + `ornaments.css`. Mockup màn `screen-auth`.

## Requirements
- Bố cục: hero (vỏ "BookSnap" + đĩa trượt ra 1 lần) + tên + tagline ở trên; segmented Đăng nhập/Đăng ký, form nhóm, nút primary 52px, dòng chân ở nửa dưới. `:focus-within` → hero co (vỏ scale .52, ẩn tagline).
- Input: username `autocapitalize=none autocorrect=off spellcheck=false enterkeyhint=next`; mật khẩu `current-password`/`new-password` + `passwordrules="minlength: 6; maxlength: 128;"` (khớp backend: min 6, max 128); mã mời không tự viết hoa; font 17px.
- Nút mắt trong ô; lỗi field: vạch đỏ + nhãn đỏ + dòng lỗi dưới nhóm (`role=alert`); lỗi form chung giữ banner.
- Busy: đĩa xoay + "Đang mở thư viện…".
- Giữ nguyên logic submit/API/lỗi hiện có.

## Files
- Modify: `web/js/views/auth-view.js`, `web/css/library.css` (tách `.auth-*` sang `web/css/auth.css`), `web/css/ornaments.css` (bỏ `.auth-frontispiece` nếu thừa), `web/index.html`

## Validation
- iPhone thật: gõ username không bị viết hoa; Keychain gợi ý; bàn phím không che nút khi focus mật khẩu.
- Lỗi mã mời sai hiện đúng ô.
