# Test report: recapture failed page

Ngày: 2026-10-05 · Trước commit · Kết quả: **PASS** (1 lỗi UI phát hiện + đã sửa)

## Tổng quan
| Lớp | Kết quả |
|---|---|
| pytest (toàn bộ) | 281/281 pass (~41s), gồm 8 test mới `tests/test_page_recapture.py` |
| node test (`tests/web`) | 135/135 pass, gồm 4 test mới `image-downscale.test.mjs` |
| E2E API (server thật, data dir cô lập, worker tắt) | 17/17 PASS |
| UI (agent-browser, viewport 390×844) | PASS sau khi sửa lỗi layout |
| Coverage | Không đo: cài `pytest-cov` lỗi build (mạng). Các nhánh của route/repo mới đã liệt kê bên dưới đều có test |

## E2E API (HTTP thật)
- upload lại cùng seq vẫn 409 `page_seq_taken` (hành vi cũ giữ nguyên)
- trang `uploaded` → 409 `page_not_replaceable`
- PNG khai báo JPEG → 415; 6MB → 413; trang lạ → 404; chưa đăng nhập → 401
- failed → 200, cùng id/seq, `uploaded`, `error=NULL`, `attempts=0`, file mới đúng bytes, file cũ bị xoá
- thay lần 2 (đã `uploaded`) → 409, không sinh file mồ côi
- ảnh hết hạn: `retry` → 409 (giới hạn cũ), recapture → 200
- `blocked_at_seq=0` trước khi chụp lại
- asset tĩnh mới phục vụ 200; log `page_image_replaced` có; không có traceback/500

## UI
- Hàng trang lỗi có 3 nút Thử lại / Chụp lại / Bỏ trang này
- **Lỗi phát hiện:** ở 390px ba nút bóp nhãn thành nhiều dòng ("Thử / lại", "Bỏ / trang / này") và bị cắt ở đáy. **Đã sửa:** class `.failed-page-actions` (flex-wrap, nhãn `nowrap`) trong `web/css/app.css`; screenshot xác nhận nút xuống hàng nguyên vẹn
- Sheet "Chụp lại Trang 1": focus vào "Chụp ảnh"; có Chụp ảnh (`capture=environment`) / Chọn từ máy / Đóng; Esc đóng sheet và trả focus về "Chụp lại"
- Chọn ảnh 4032×3024 (1.17MB) → gửi 2000×1500 (273KB) → toast "Đang nhận dạng lại trang 1", không có banner lỗi; DB: `uploaded`, `attempts=0`

## Không kiểm được ở đây
- Camera thật / iOS Safari / PWA standalone (cần thiết bị). OCR thật bằng Gemini (worker tắt có chủ đích)

## Câu hỏi chưa giải quyết
- Bản iOS thấp nhất cần hỗ trợ (để kiểm EXIF/`createImageBitmap`)
