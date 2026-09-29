# Phase 2 — Thư viện: thùng đĩa, menu chủ đề, hero, tìm kiếm

## Context
Mockup màn `screen-library`. Hiện tại: `web/js/views/library-view.js` (`groupIntoShelves`, `BookCard`, offline fallback), `web/css/library.css`.

## Requirements
- Header: eyebrow "BookSnap · Thư phòng gia đình", "Thư viện", avatar chữ cái đầu (chạm → sheet nhỏ có Đăng xuất; giữ logout hiện có).
- Hero "Nghe tiếp" (`OrnateFrame`): sách đầu của `continueListening`, "Đoạn n/N", nút primary → `#/listen/:id`; không có sách đang nghe → ẩn hero.
- Ô tìm (`type=search`, bỏ dấu `NFD` + `đ→d`), hàng "x đĩa · y thùng" + nút menu "Mọi chủ đề ⌃⌄" (`aria-haspopup="menu"`), menu `menuitemradio` có ✓ + số sách, đóng khi chạm ngoài/Esc, focus trả về nút.
- Thùng: tab sticky (`.crate-head` sticky top 0, nền `--bg`), hàng vỏ đĩa cuộn ngang (≥768px lưới). Mục: vỏ + đĩa ló (chỉ `ready`), tên, "Chụp bởi", tiến độ, trạng thái ("Đang ép đĩa · x/y" cho processing).
- Chạm mục: `ready` → `#/listen/:id`; khác → `#/book/:id` (offline → `#/read/:id` như cũ).
- Giữ `groupIntoShelves` (đổi tên export không cần — tái dùng), offline fallback, skeleton, empty state.

## Files
- Create: `web/js/components/library-hero-card.js`, `web/js/components/topic-filter-menu.js`, `web/js/text-fold.js` (bỏ dấu)
- Modify: `web/js/views/library-view.js`, `web/css/library.css` (xoá style bìa cũ/kệ cũ), `web/css/ornaments.css` (bỏ `.shelf-title` nếu không còn dùng)

## Steps
1. `text-fold.js` + lọc client-side (tên sách).
2. `TopicFilterMenu` (state mở/đóng, scrim, Esc, focus).
3. `LibraryHeroCard`.
4. Viết lại render thùng + mục trong `library-view.js`; giữ < 200 dòng bằng cách tách component.

## Validation
- 375px: không cuộn ngang trang; menu không tràn khung.
- Offline: danh sách sách đã tải vẫn render thành thùng; hero ẩn.
- Chọn chủ đề không còn sách (sau khi tìm) → empty state có nút xoá tìm.

## Risks
Sticky header trong `.app-main` cần scroll container là document — kiểm iOS Safari (không đặt `overflow` trên tổ tiên).
