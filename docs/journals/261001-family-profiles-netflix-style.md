# Hồ sơ gia đình kiểu Netflix + Kệ của tôi

**Ngày**: 2026-10-01
**Mức độ**: High
**Thành phần**: Auth, Session, DB migration, Web shell
**Trạng thái**: Code xong trên `feat/family-profiles`; chưa deploy

## Diễn biến

Yêu cầu: 1 tài khoản gia đình → nhiều hồ sơ, tiến độ/bookmark/kệ riêng. Thay vì thêm bảng `profiles` và đổi ~110 tham chiếu `user_id`, biến chính bảng `users` thành hồ sơ và thêm lớp `accounts` cho đăng nhập. Mọi cột `user_id` cũ giữ nguyên nghĩa (= id hồ sơ) → route nghiệp vụ không đổi chữ ký. Session lưu `account_id` + hồ sơ đang chọn (nullable).

## Sự thật khó chịu

- **Rebuild bảng SQLite là bãi mìn.** `DROP TABLE users` khi FK bật sẽ CASCADE xoá sạch progress/bookmarks; `PRAGMA foreign_keys` vô tác dụng trong transaction; `executescript()` của Python 3.12 tự COMMIT transaction đang mở. Runner `TableRebuild` phải tắt FK ngoài transaction, đặt `BEGIN` trong script, `foreign_key_check` trước COMMIT, ROLLBACK mọi lỗi.
- **Red-team bắt lỗi chí mạng trước khi code:** `deploy.sh` tự rollback image cũ nhưng không khôi phục DB → image cũ chạy trên schema v6, `/health` vẫn xanh, cả nhà mất đăng nhập. Sửa bằng downgrade guard phát hành riêng trước (`1207dc8`).
- **Cookie dùng chung mọi tab** nên "hồ sơ đang chọn" là trạng thái toàn trình duyệt: tab A ghi tiến độ vào hồ sơ tab B vừa chọn. Thêm header `X-Profile-Id` (lệch → 409). Review web vẫn tìm ra lỗ hổng: flush tiến độ lúc unmount sau 409 không có header → phải ghim profile id ngay trong `PlaybackProgress`.
- `created_at` chỉ chính xác tới giây → hai hồ sơ tạo cùng giây sắp xếp ngẫu nhiên; dùng `rowid` làm tie-break (quan trọng vì "hồ sơ tạo sớm nhất" nhận sách khi xoá hồ sơ).
- Docs do subagent viết có 3 sai sót thực tế (mã lỗi 404/401 thay vì 409, CLI "tự sinh mật khẩu", runbook dùng đường dẫn host không tồn tại) → phải tự soát lại với code.

## Chi tiết kỹ thuật

- pytest: 262 passed; node: 84 passed; E2E headless 390px: đăng ký, thêm hồ sơ, picker sau login, kệ riêng, 2 tab đồng bộ, hồ sơ bị xoá từ xa → picker (không rơi vào offline).
- Commit: `1207dc8` (guard, main), `7715619`, `3dc123f`, `72d62d7`, `3da4cca`, `cfb426c`.
- Login/register trả `LoginOut` tương thích ngược (trường hồ sơ ở top-level) để client cũ trong SW cache không vỡ.
- Voice preview giới hạn theo account (không để 8 hồ sơ nhân 8 lần quota trả phí).

## Hạn chế đã biết

- Không PIN, không hồ sơ trẻ em (quyết định của chủ app); `ensure_book_owner` chỉ chống nhầm.
- Overlay giữ ảnh chụp dở khi mất hồ sơ chưa kiểm tay được (cần camera thật).
- Tên đăng nhập/mật khẩu riêng của thành viên cũ hết hiệu lực sau migration.

## Chưa làm

- Push `main` + deploy guard lên prod trước; sau đó merge branch, tập dượt migration trên bản sao DB prod theo runbook 9.4 trong `docs/deployment-vps-guide.html`.
