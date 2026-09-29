# Đổi font display: Cormorant Garamond → Playfair Display

Status: done (chưa commit) · Mode: interactive

## Quyết định (user)
- Font: **Playfair Display** (Google Fonts, subset vietnamese).
- Phạm vi: đổi token `--font-display` (mọi tiêu đề, tên sách, label form đăng nhập, menu heading, drop cap, nhãn kệ) + nút Đăng nhập/Đăng xuất dùng font mới (hiện `--font-ui`).

## Out of scope
- `--font-read` (Literata), `--font-ui` (Be Vietnam Pro) cho phần còn lại của UI.
- Mockups trong `docs/mockups/`.

## Touchpoints
| File | Thay đổi |
|---|---|
| `web/css/tokens.css` | `@import` Playfair Display 500–700 thay Cormorant; `--font-display` |
| `web/css/auth.css` | tab segmented + `.signin-submit` dùng `--font-display` |
| `web/css/account.css`, `web/css/library.css` | `.account-signout`, `.menu-item--signout` dùng `--font-display` |
| `web/js/components/library-account-menu.js` | thêm class `menu-item--signout` cho nút Đăng xuất |
| CSS size tuning | giảm cỡ/giãn chữ các nhãn in hoa đã bù cho x-height thấp của Cormorant nếu tràn |
| `web/js/components/vinyl-disc.js` | chỉnh `font-size` nhãn đĩa nếu dòng 12 ký tự tràn vòng nhãn |
| `web/sw.js` | bump `SHELL_CACHE` v12 → v13 |
| `docs/design-guidelines.md` | cập nhật bảng font + ghi chú cỡ chữ |

## Acceptance criteria
1. Tiêu đề trang, tên sách (sleeve, đĩa, now-playing, reader), màn đăng nhập (brand, label, tab, nút submit), nút Đăng xuất (menu + trang tài khoản) render Playfair Display.
2. Dấu chồng tiếng Việt (ẫ ự ổ ặ ở Ấ Ự) không bị cắt/đè ở mọi vị trí trên.
3. Không tràn/ellipsis mới: crate tab, menu heading, label form, sleeve title (3 dòng), nhãn đĩa, reader title ở 375px.
4. Client cũ nhận CSS mới (SW cache bump).
5. `pytest` vẫn pass (không đụng backend).

## Validation
- Screenshot 375px + desktop: sign-in, library, now-playing, reader, account (agent-browser).
- `pytest -q`.

## Rollback
Revert `tokens.css` token + import (1 commit), các chỉnh size độc lập.

## Kết quả
- Pass: 141 pytest, `node --check` JS, screenshot 375/390px (sign-in, thư viện, menu, tài khoản, nhãn đĩa, drop cap).
- Review 2 vòng: dấu chồng bị cắt ở hero/sleeve/menu/mini-player/rec-title → sửa line-height/padding-top; titleScale tính chữ hoa 1.35 + min 0.5; BOOKSNAP 4.2px; drop cap 3em; số thống kê dùng `--font-ui` (Playfair không có tnum).
- Chấp nhận (low): từ tiếng Anh ≥13 chữ có thể gãy ở hero trên màn 381–412px; dấu hoa chạm nhẹ descender dòng trên ở vỏ đĩa; đỉnh drop cap thấp hơn chữ hoa dòng 1 ~5px.
