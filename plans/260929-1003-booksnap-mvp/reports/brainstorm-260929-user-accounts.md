# Brainstorm: tài khoản người dùng BookSnap

Date: 2026-09-29 · Status: approved · Plan: [../plan.md](../plan.md)

## Vấn đề
Plan cũ dùng 1 `APP_TOKEN` chung → chỉ 1 người, tiến độ nghe theo sách. Cần: nhiều người dùng chung app, mỗi người có định danh để nhớ đang đọc/nghe dở cuốn nào. Không cần xác thực (email/OTP).

## Yêu cầu chốt
- Đăng ký/đăng nhập cơ bản: username + display name + mật khẩu; không email, không verify.
- Chặn người lạ: mã mời (`INVITE_CODE`) khi đăng ký — URL Railway công khai, tránh đốt quota Gemini.
- Thư viện chung, tiến độ riêng từng người.
- Out of scope: email, OAuth, quên mật khẩu tự phục vụ, admin UI, roles, avatar.

## Phương án đã cân nhắc
| Chủ đề | Chọn | Loại | Lý do |
|---|---|---|---|
| Định danh | Username + mật khẩu | Profile picker không mật khẩu; PIN 4 số | Đúng "đăng nhập/đăng ký cơ bản", mỗi người chỉ vào hồ sơ mình; chi phí ~ngang |
| Chặn lạ | Mã mời | Đăng ký tự do | Quota Gemini là tài nguyên hữu hạn |
| Thư viện | Chung, tiến độ riêng | Riêng từng người; riêng + share | Không OCR/TTS trùng 1 cuốn; KISS |
| Session | DB sessions (token ngẫu nhiên, lưu hash) | Signed cookie stateless | Đăng xuất/thu hồi được; bảng nhỏ |

## Thiết kế
- `users(id, username UNIQUE COLLATE NOCASE, display_name, password_hash, created_at)`
- `sessions(token_hash PK, user_id, created_at, last_seen_at, expires_at)` — cookie httpOnly, 180 ngày sliding
- `books.created_by`; `progress PK(user_id, book_id)`
- Argon2 (`argon2-cffi`); rate limit in-memory ~10 req/phút/IP cho login/register
- Quyền: mọi người xem/nghe/sửa text đoạn/thêm trang; chỉ người tạo đổi giọng sách + xoá sách
- Reset mật khẩu: `python -m app.cli reset-password <username>` qua Railway shell
- UI: màn chào 2 tab Đăng nhập/Đăng ký; "Tiếp tục nghe" theo user; "Chụp bởi …"

## Rủi ro
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| Lộ mã mời | L | M | Đổi `INVITE_CODE`; tài khoản cũ không ảnh hưởng |
| Quên mật khẩu | M | L | CLI reset |
| Đổi giọng/xoá nhầm sách người khác | L | M | Chỉ người tạo |
| Brute-force mật khẩu yếu (≥6 ký tự) | L | L | Rate limit; dữ liệu không nhạy cảm |

## Tiêu chí thành công
- 2 tài khoản nghe cùng 1 sách ở 2 vị trí khác nhau, mỗi người mở lại đúng vị trí của mình.
- Đăng ký sai/thiếu mã mời → bị từ chối; mọi `/api/*` (trừ login/register) trả 401 khi chưa đăng nhập.
- User B không xoá/đổi giọng được sách của A (403).

## Tác động plan
Phase 1 (+0.5–1 ngày), 3 (màn auth), 4 (progress theo user), 5 (env `INVITE_CODE`, bỏ `APP_TOKEN`, CLI reset). Tổng ~6.5–8 ngày.
