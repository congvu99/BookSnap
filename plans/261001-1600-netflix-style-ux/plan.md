---
title: "Netflix-style UX (giữ phong cách đĩa than)"
status: in-progress
priority: P2
branch: "feat/netflix-ux"
tags: [web, ux, motion]
created: "2026-10-01T16:00:00+07:00"
source: skill
---

# Netflix-style UX

Nguồn: [mockup](../../docs/mockups/netflix-style-ux-preview.html) · [brainstorm cấu trúc](../reports/brainstorm-261001-1530-netflix-style-ux-restructure.md) · [brainstorm chuyển động](../reports/brainstorm-261001-1500-visible-motion-and-slider-zoom.md)

## Quyết định chốt
- Giữ phong cách đĩa than (màu, bìa hoa văn, đĩa). Phông UI + tiêu đề: **Inter** (800, chữ khít); bìa sách + nhãn đĩa giữ **Playfair Display** (`--font-cover`).
- **Luôn bật hiệu ứng**: bỏ mọi chặn `prefers-reduced-motion`.
- Thanh kéo: ray phình + thumb ~1.75× + bong bóng giá trị; tua/lưu khi thả; âm lượng nghe thử khi kéo.
- Chuyển trang kiểu iOS (push từ phải / pop / tab crossfade) bằng View Transitions, fallback CSS.
- Đổi hồ sơ: chạm avatar → bottom sheet 1 chạm; avatar bay ra giữa rồi vào thư viện; picker stagger + bút chì khi quản lý.
- Tab **Của tôi** thay Tài khoản; thanh dưới: Thư viện · Chụp · Đang nghe · Của tôi (avatar).
- Thư viện dạng hàng: hero → Nghe tiếp của {tên} → Kệ của tôi → Mới thêm → mỗi chủ đề; "Xem tất cả" là link chữ ở đầu hàng → màn lưới.

## Phần việc (song song, file ownership)

| # | Phần | Agent | File sở hữu |
|---|---|---|---|
| A | Nền chuyển động + thanh kéo + phông | A | `web/css/*` (chỉ các khối reduced-motion), `app.css`, `tokens.css`, `vinyl.css` (font bìa), `motion.css`, `reader.css`/`now-playing.css` (phần slider), `index.html` (link phông), `components/range-slider.js`, mới `route-transition.js`, `tests/web/route-transition.test.mjs` |
| B | Hồ sơ kiểu Netflix | B | mới `profile-switcher.js`, `components/profile-switch-sheet.js`, `profile-zoom.js`; sửa `views/profile-picker-view.js`, `profiles.css` |
| C | Tab Của tôi + điều hướng | C | `app.js` (route), `components/bottom-nav.js`, mới `views/me-view.js` + màn con, mới `css/me.css`; `account-view.js` tách/giữ |
| D | Thư viện dạng hàng | D | `views/library-view.js`, mới `components/library-rail.js`, mới `views/library-browse-view.js`, `library.css` (trừ khối reduced-motion), mới helper thuần `library-rails.js` + test |
| — | Tích hợp | controller | `app.js` (gắn transition + sheet sau khi A/B xong), `sw.js`, test, review, merge |

## Hợp đồng giữa các phần
- B xuất `openProfileSwitcher()` từ `web/js/profile-switcher.js` (D, C gọi khi chạm avatar) và component `ProfileSwitchSheet` (controller gắn vào app shell).
- D xuất `LibraryBrowseView({ railKey })` từ `web/js/views/library-browse-view.js`; C thêm route `#/browse/:railKey` render nó.
- A xuất `runRouteTransition(direction, update)` từ `web/js/route-transition.js` (`direction`: 'push' | 'pop' | 'tab' | 'none'); controller gọi trong app.js.
- Route mới: `#/me`, `#/me/<section>` (shelf, downloads, quota, password, theme); `#/account` → chuyển về `#/me`.

## Nghiệm thu
- Máy Windows tắt "Show animations" vẫn thấy chuyển động.
- Thanh tua/âm lượng phình + bong bóng; giá trị chốt khi thả.
- Đổi hồ sơ 1 chạm từ avatar; avatar bay; thư viện đổi theo hồ sơ.
- Tab Của tôi có nhóm + màn con trượt; thanh dưới 4 mục mới.
- Thư viện các hàng; "Xem tất cả" mở lưới.
- `node --test` + `pytest` xanh; kiểm headless 390px.
