# Brainstorm: Tải nhanh + loading kiểu Netflix

Ngày: 2026-10-01 · Trạng thái: **đã duyệt (phương án A + gzip/preload)** · Môi trường: Railway

## Vấn đề (người dùng: "bấm vào load chậm quá")
Chậm ở 4 chỗ: bấm sách → màn nghe; chuyển tab/màn; mở app lần đầu; bấm Phát chưa có tiếng.

Nguyên nhân (scout):
- `reader-view.js:75-84`: book+chunks song song → **rồi** `getProgress` (`playback-progress.js:25`) → rồi audio; 3 nhịp mạng nối tiếp; chờ bằng khối xám 300px (`:292`).
- Màn nghe chờ lại dữ liệu đã có trong thư viện (tên, màu, thời lượng, tiến độ).
- `chunks` trả toàn bộ chữ sách; Railway nhiều khả năng không nén.
- Không bundle: ~70 module JS tải theo chuỗi import lần đầu.
- Audio đoạn đầu chỉ tải khi bấm Phát.

## Quyết định (A mở rộng)
1. **Màn nghe tức thì**: bìa bay từ thẻ sang màn nghe (View Transitions, `view-transition-name` chia sẻ); vẽ ngay từ dữ liệu thư viện (cache); skeleton ánh quét cho chữ; đĩa quay chậm làm loader, kim hạ khi audio sẵn sàng; prefetch book+chunks (+ audio đoạn hiện tại) ngay `pointerdown`; `getProgress` song song.
2. **Các màn khác**: skeleton đúng hình (trang sách, browse, Của tôi + màn con, đánh dấu); cache bộ nhớ stale-while-revalidate để lần 2 hiện ngay.
3. **Mở app**: `GZipMiddleware` (trừ `audio/*`); `<link rel="modulepreload">` cho module chính (kiểm khớp SHELL_ASSETS bằng test); loader đĩa than tĩnh trong `index.html` trước khi JS chạy và khi chờ `/api/me`.
4. **Phát**: preload audio đoạn hiện tại khi vào màn nghe; vòng buffering đã có.

Ngoài phạm vi: tách nhỏ API `chunks` (phương án C).

## Rủi ro
| Risk | L | I | Mitigation |
|---|---|---|---|
| Nén làm hỏng stream audio / Range | M | H | Loại trừ `audio/*` + đường `/api/chunks/*/audio`; test |
| modulepreload lệch SHELL_ASSETS | M | L | Test kiểm mọi path preload nằm trong SHELL_ASSETS & tồn tại |
| Prefetch phí khi lướt | M | L | Chỉ book+chunks+audio đoạn đầu; huỷ bỏ nếu không vào trong 10s (cache có TTL) |
| Dữ liệu cache lệch hồ sơ | L | M | Cache bộ nhớ key theo profile id; xoá khi đổi hồ sơ |

## Nghiệm thu
- Slow 4G giả lập: bấm bìa → màn nghe có bìa/tên/đĩa < 100ms, chữ hiện skeleton rồi điền.
- Lần 2 vào Của tôi/Kệ/Xem tất cả: không skeleton.
- Mở app: thấy loader đĩa than ngay, không màn trắng.
- Response JSON/JS có `content-encoding: gzip`; audio không.
- `pytest` + `node --test` xanh.
