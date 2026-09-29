# Brainstorm: Thùng đĩa than + màn Đang nghe + Đánh dấu + Đăng nhập iOS

Ngày: 2026-09-29 · Mockup đã duyệt: [docs/mockups/vinyl-library-preview.html](../../docs/mockups/vinyl-library-preview.html) · Ảnh: `docs/mockups/shots/vinyl-*.png`

## Vấn đề
- Thư viện sơ sài (kệ phẳng, bìa 2D, "Tiếp tục nghe" chỉ lặp bìa).
- Không có màn nghe riêng; muốn cổ điển kiểu đĩa than.
- Trang đăng nhập dựng kiểu web, chưa tối ưu iPhone (iOS tự viết hoa username, form không ở tầm ngón cái).

## Quyết định (user)
| # | Quyết định |
|---|---|
| V1 | Palette đỏ/vàng/ngà giữ nguyên. **Không dùng gỗ** (đã thử kệ gỗ + mâm gỗ → bị loại) |
| V2 | Thư viện = **thùng đĩa than**: mỗi sách một **vỏ đĩa vuông**, đĩa ló ra bên phải; sách chưa `ready` không có đĩa ("Đang ép đĩa · x/y") |
| V3 | Bìa **5 màu da** chọn cố định theo `hash(book.id) % 5` (wine, moss, slate, amber, parchment). Đảo quyết định T4 (một bìa đỏ chung). Khung hoa văn giữ nguyên, tỉ lệ đổi 2:3 → 1:1 |
| V4 | Mỗi chủ đề = thùng (`--surface-sunken`, viền vàng, tab chia ngăn); **tab thùng sticky** khi cuộn |
| V5 | Lọc chủ đề = **nút pull-down menu** kiểu iOS ("Mọi chủ đề ⌃⌄") trên hàng tóm tắt; không dùng chip/tab cuộn ngang |
| V6 | Hero "Nghe tiếp" = khung `OrnateFrame` + vỏ đĩa có đĩa ló ra; ô tìm kiếm bỏ dấu (client-side) |
| V7 | Màn **Đang nghe** = chế độ `listen` của `ReaderView` (route `#/listen/:id`, cùng instance với `#/read/:id` → không ngắt audio). Vỏ đĩa trái, **Phát → đĩa trượt ra + xoay 33⅓ vòng/phút + cần đĩa đồng thau hạ**; góc cần theo % tiến độ (9.5° → 29.5°); **Tạm dừng → cần nhấc, đĩa trượt về vỏ** |
| V8 | Chế độ đọc: nút đĩa trên topbar → listen; mini player có vỏ + đĩa nhỏ xoay |
| V9 | **Đánh dấu** full-stack, riêng từng user, khoá `(user_id, book_id, chunk_seq)`; bottom nav **4 mục**: Thư viện · Đánh dấu · [Chụp] · Đang nghe |
| V10 | Đăng nhập iOS: hình (vỏ + đĩa) trên, segmented Đăng nhập/Đăng ký + form nhóm + nút ở nửa dưới; focus → hero co lại; đĩa xoay khi busy; `autocapitalize=none`, `autocorrect=off`, `spellcheck=false`, `enterkeyhint`, `passwordrules`, font ≥16px |

## Kiến trúc chính
- `AudioPlaylist` sống trong `ReaderView` → listen/read phải là 2 mode của cùng component (cùng `key`, cùng vị trí vnode trong `app.js`). Player global = ngoài phạm vi.
- Bookmark theo `chunk_seq` (không theo `chunk.id`) vì chunk đuôi chưa sealed bị xoá/tạo lại khi chụp thêm trang (`chunk_repository.replace_tail`).
- Migration append-only: `bookmarks(user_id, book_id, chunk_seq, created_at, PK(user_id,book_id,chunk_seq))`, CASCADE theo user/book.
- API: `GET /api/bookmarks` (kèm tên sách + trích 160 ký tự đầu), `PUT`/`DELETE /api/books/{id}/bookmarks/{seq}` (idempotent).

## Ngoài phạm vi
Player global (mini player ở Thư viện), tác giả/series, mục lục chương, ghi chú bookmark, kéo đĩa để tua, màu theo chủ đề, palette Nordic.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| ReaderView remount khi đổi read↔listen → ngắt nhạc | Render cùng vị trí/key; test chuyển mode khi đang phát |
| Animation vô hạn tốn pin | Chỉ chạy khi `playing`; `prefers-reduced-motion` tắt hết |
| Safari iOS bỏ qua `interactive-widget` | Hero co bằng `:focus-within`; kiểm trên máy thật |
| Guidelines cũ (T4, §6.2, §9) mâu thuẫn | Cập nhật `docs/design-guidelines.md` cùng lúc |
| SW cache giữ bản cũ | Bump `SHELL_CACHE` |

## Tiêu chí nghiệm thu
- read↔listen khi đang phát: không ngắt audio, giữ vị trí.
- Đĩa chỉ xoay khi phát; reduced-motion tĩnh hoàn toàn.
- Cùng sách cùng màu trên mọi thiết bị; chữ bìa ≥4.5:1 trên 5 màu.
- Tìm "chuyen lang" ra "Chuyện làng ven sông"; menu chủ đề + tìm kết hợp; empty state.
- 375px không cuộn ngang toàn trang; touch target ≥44px.
- Bookmark: PUT/DELETE idempotent, user khác không thấy, xoá sách → mất theo, migration không mất dữ liệu, test cũ pass.
- Đăng nhập: username không bị tự viết hoa; Keychain autofill; lỗi hiện dưới ô.

## Câu hỏi còn mở
- Không có.
