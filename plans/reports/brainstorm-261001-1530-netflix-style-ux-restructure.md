# Brainstorm: Tái cấu trúc UX theo tư duy Netflix (giữ phong cách đĩa than)

Ngày: 2026-10-01 · Trạng thái: **đã duyệt hướng, chờ duyệt mockup** · Kế thừa: [visible motion + slider zoom](./brainstorm-261001-1500-visible-motion-and-slider-zoom.md)

## Vấn đề

Người dùng: "không thấy hiệu ứng", muốn app "mang tư duy Netflix" cho cài đặt, chuyển hồ sơ, sắp xếp. Problem-first: không phải thiếu animation, mà **cấu trúc thông tin chưa phân tầng** và **thao tác chính tốn bước** (đổi hồ sơ = 3 chạm + 1 màn; cài đặt = 1 trang form dài; kệ là bộ lọc ẩn).

## Hiện trạng vs mẫu Netflix

| Khu | Hiện tại | Mẫu Netflix | Khoảng cách |
|---|---|---|---|
| Đổi hồ sơ | avatar → menu → "Đổi hồ sơ" → picker → chọn | chạm avatar → bảng avatar → 1 chạm; avatar phóng to → trang chủ | nhiều bước, không có khoảnh khắc chuyển |
| Cài đặt | `account-view.js`: thẻ hồ sơ + hạn mức + form tên + form mật khẩu + đăng xuất | tab "Của tôi": header hồ sơ + danh sách nhóm hàng `›`, mỗi hàng 1 màn con | form lộ hết, không phân tầng |
| Thư viện | hero + thùng theo chủ đề + bộ lọc chủ đề + nút "Kệ của tôi" (bộ lọc) | hero + hàng ngang theo ngữ nghĩa | thiếu hàng "Kệ của tôi", "Mới thêm" |
| Điều hướng | Thư viện · Đánh dấu · Chụp · Đang nghe | Home · … · Downloads · My Netflix | chưa có tab hồ sơ; "đã tải offline" ẩn trong sheet |

## Quyết định

- **Giữ phong cách đĩa than** (tokens, bìa đĩa, ornament); học cấu trúc + chuyển động Netflix. Không dùng nền đen/đỏ/logo Netflix.
- Phạm vi đợt này: 4 phần — (1) hồ sơ kiểu Netflix, (2) tab "Của tôi", (3) thư viện dạng hàng, (4) thanh kéo phóng to + chuyển trang (theo báo cáo trước: luôn bật hiệu ứng, âm lượng nghe thử khi kéo/chốt khi thả, View Transitions kiểu iOS).
- **Mockup HTML trước**, duyệt rồi mới sửa app.

## Thiết kế đề xuất (để dựng mockup)

1. **Hồ sơ**
   - Chạm avatar (header thư viện / tab "Của tôi") → bottom sheet "Đổi hồ sơ": hàng avatar lớn, hồ sơ đang dùng có viền vàng, "Quản lý hồ sơ" ở cuối.
   - Chọn → avatar bay/phóng ra giữa màn (≈450ms) → mờ vào thư viện của hồ sơ mới.
   - "Ai đang nghe?": avatar xuất hiện lần lượt (stagger 60ms); chế độ quản lý: biểu tượng bút chì phủ trên avatar, avatar lắc nhẹ? (không — chỉ bút chì, tránh trẻ con hoá).
2. **Tab "Của tôi"** (thay `#/account`, thay mục "Đánh dấu" ở thanh dưới):
   - Header: avatar lớn + tên + "Đổi hồ sơ ›".
   - Nhóm "Của tôi": Kệ của tôi · Đánh dấu · Đã tải để nghe offline.
   - Nhóm "Gia đình": Quản lý hồ sơ · Mật khẩu gia đình · Hạn mức dịch vụ.
   - Nhóm "Ứng dụng": Giao diện (sáng/tối/theo máy), Nhạc nền mặc định.
   - Đăng xuất tài khoản gia đình (cuối, màu nhạt).
   - Mỗi hàng mở màn con trượt từ phải (push), nút ‹ trượt về.
3. **Thư viện dạng hàng**: hero "Nghe tiếp" → hàng "Nghe tiếp của {tên}" (có thanh tiến độ trên bìa) → "Kệ của tôi" → "Mới thêm" → mỗi chủ đề 1 hàng; mỗi hàng cuộn ngang snap + "Xem tất cả ›". Tìm kiếm thành biểu tượng kính lúp trên header (mở ô tìm full-width).
4. **Thanh điều hướng dưới**: Thư viện · Chụp (nút tròn giữa) · Đang nghe · Của tôi (avatar nhỏ).
5. **Thanh kéo + chuyển trang**: như báo cáo trước.

## Rủi ro / đánh đổi

| Risk | L | I | Mitigation |
|---|---|---|---|
| Đổi điều hướng làm người quen cũ lạc ("Đánh dấu" đâu?) | M | M | Đặt "Đánh dấu" là hàng đầu trong "Của tôi"; giữ route `#/bookmarks` |
| Thư viện nhiều hàng chậm khi nhiều sách | L | M | Mỗi hàng giới hạn ~20 bìa + "Xem tất cả" |
| Effort lớn (≈4–5 ngày cho 4 phần) | H | M | Mockup trước để chốt, làm theo thứ tự 4 → 1 → 3 → 2, merge từng phần |
| Bỏ reduced-motion | L | M | Quyết định chủ app (báo cáo trước) |

## Bước tiếp

1. Mockup tương tác: `docs/mockups/netflix-style-ux-preview.html` (+ link xem trên điện thoại).
2. Người dùng duyệt / chỉnh → `/ck:plan` 4 phase → cook song song, merge từng phase.
