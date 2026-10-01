# Brainstorm: Hồ sơ gia đình kiểu Netflix

Ngày: 2026-10-01 · Trạng thái: **đã duyệt** · Modes: (không flag)

## Vấn đề

- Hiện tại: mỗi thành viên = 1 tài khoản riêng (username + mật khẩu, đăng ký bằng `INVITE_CODE`). Thư viện chung; `progress`, `bookmarks` đã tách theo `user_id`.
- Đau thật: đổi người = logout/login; trẻ con không tự đăng nhập; tablet chung bất tiện; chưa có kệ cá nhân.
- Mục tiêu: 1 tài khoản gia đình → nhiều hồ sơ (như Netflix), mỗi hồ sơ có tiến độ, bookmark, "Kệ của tôi", tên + avatar riêng.

## Yêu cầu đã chốt

| Mục | Quyết định |
|---|---|
| Mô hình login | 1 tài khoản gia đình → N hồ sơ, hồ sơ không mật khẩu |
| Tủ riêng | "Kệ của tôi" (My List) — sách vẫn chung, mỗi hồ sơ tự thêm/bớt |
| Bảo vệ | Không PIN, không hồ sơ trẻ em |
| Cá nhân hoá mới | Tên + avatar (tiến độ, bookmark đã riêng sẵn) |
| Migration | Gộp: user tạo sớm nhất → login gia đình (giữ username/mật khẩu); mọi user → hồ sơ, giữ progress/bookmark; backfill session |
| Phạm vi server | Chỉ 1 nhà; sách/chủ đề/audio chung toàn server |
| Quyền sách | Giữ: chỉ hồ sơ tạo sách được sửa/xoá (`ensure_book_owner`) |

Ngoài phạm vi: PIN, hồ sơ trẻ em, multi-household, theme/nhạc nền/tốc độ theo hồ sơ.

## Phương án đã xét

| | A. Hồ sơ = `users` + bảng `accounts` ✅ | B. Bảng `profiles` mới, rename `user_id`→`profile_id` | C. Switcher client-only |
|---|---|---|---|
| Schema | +2 bảng, +vài cột | Rebuild 4–5 bảng SQLite | 0 |
| Code chạm | ~10 file | ~110 tham chiếu | client |
| Effort | 2.5–3 ngày | 5–7 ngày | 1 ngày |
| Rủi ro hồi quy | Thấp | Cao | Thấp |
| Đạt "1 tài khoản" | ✓ | ✓ | ✗ |

Chọn A: tái dùng toàn bộ logic `user_id` (progress, bookmarks, created_by) vì `user_id` giờ mang nghĩa profile id. Nợ duy nhất: tên cột — ghi chú trong `docs/system-architecture.md`.

## Giải pháp (contract)

```text
accounts(id, username UNIQUE NOCASE, password_hash, created_at)
users    + account_id FK accounts, + avatar TEXT, bỏ username/password_hash (rebuild bảng) -- = hồ sơ
sessions + account_id FK accounts, user_id -> nullable (null = chưa chọn hồ sơ)
shelf_items(user_id FK CASCADE, book_id FK CASCADE, added_at, PK(user_id, book_id))
```

Lưu ý SQLite: đổi `NOT NULL` → nullable cho `users.password_hash`, `sessions.user_id` cần rebuild bảng (CREATE new → INSERT SELECT → DROP → RENAME) trong migration; `PRAGMA foreign_keys` phải tắt khi rebuild (ngoài transaction) hoặc dùng `legacy_alter_table` cẩn thận.

API:

| Endpoint | Hành vi |
|---|---|
| `POST /auth/login` | Xác thực account; session `user_id=null` |
| `POST /auth/register` | Chỉ khi chưa có account nào + đúng `INVITE_CODE`; tạo account + hồ sơ đầu |
| `GET /profiles` | Hồ sơ của account |
| `POST /profiles`, `PATCH /profiles/{id}`, `DELETE /profiles/{id}` | CRUD tên/avatar; xoá → CASCADE progress/bookmark/kệ; chặn xoá hồ sơ cuối; sách `created_by` hồ sơ bị xoá → cần xử lý (xem câu hỏi mở) |
| `POST /profiles/{id}/select` | UPDATE `sessions.user_id`; không xoay token |
| `require_user` | Không session → 401; chưa chọn hồ sơ → `409 profile_required` |
| `PUT/DELETE /me/shelf/{book_id}`, `GET /books?shelf=mine` | Kệ cá nhân |
| `POST /me/password` | Đổi mật khẩu → chuyển sang account |

Client: màn `ProfilePicker` ("Ai đang nghe?"), mục đổi hồ sơ trong menu, tab/bộ lọc "Kệ của tôi", quản lý hồ sơ trong trang Tài khoản. Cache `booksnap:progress:{userId}:*` giữ khi đổi hồ sơ; logout account mới xoá. Bump `SHELL_CACHE` trong `web/sw.js`.

Độ phức tạp: select O(1); lọc kệ JOIN theo PK, n sách nhỏ. Worker OCR/TTS không đổi.

## Rủi ro

| Risk | L | I | Mitigation |
|---|---|---|---|
| Migration gộp sai → mất login/progress | M | H | Backup (`deploy/backup.sh`) trước deploy; migration 1 transaction; test fixture 3 user + session + progress + bookmark |
| Session cũ thiếu `account_id` | H | M | Backfill trong migration, giữ `user_id` → không ai bị logout |
| FK khi rebuild bảng SQLite | M | H | Test migration trên bản sao DB prod trước |
| Ai cầm máy vào mọi hồ sơ | H | L | Chấp nhận (quyết định user); để ngỏ `pin_hash` sau |
| `ensure_book_owner` chỉ chống nhầm, không phải bảo mật | H | L | Ghi rõ trong docs |
| SW cache UI cũ | M | M | Bump `SHELL_CACHE` |

SPOF: không thêm mới. Pháp lý/compliance: không dữ liệu cá nhân mới ngoài tên/avatar.

## Vận hành

- Log `profile_selected account=… profile=…`; gắn `profile_id` vào log request.
- Docs cập nhật: `docs/system-architecture.md` (auth, schema, API), README (đăng ký/đăng nhập), `docs/project-roadmap.md`.

## Tiêu chí nghiệm thu

1. Login 1 lần → chọn A, nghe tới đoạn 5 → đổi B thấy tiến độ B → về A vẫn đoạn 5.
2. A thêm sách vào kệ → chỉ kệ A có; thư viện chung vẫn đủ.
3. DB cũ 3 user → 1 login + 3 hồ sơ, đủ progress/bookmark, session cũ vẫn sống.
4. B không xoá được sách A chụp (403).
5. Chưa chọn hồ sơ → `409 profile_required` → client hiện picker.
6. Đăng ký bị đóng khi đã có account.

## Bước tiếp

`/ck:plan --tdd` (thay đổi auth + migration dữ liệu thật → khoá hành vi bằng test trước).

## Câu hỏi mở

- Xoá hồ sơ đã tạo sách: chặn xoá, hay chuyển `created_by` sang hồ sơ đang thao tác? (Đề xuất: chuyển sang hồ sơ đang thao tác.)
- Bộ avatar: emoji + màu nền chọn sẵn (đề xuất) hay upload ảnh? (upload = ngoài phạm vi.)
- Giới hạn số hồ sơ (Netflix = 5)? Đề xuất 8.

## Cập nhật khi lập plan (2026-10-01)

Câu hỏi mở đã chốt mặc định trong [plan](../261001-0915-family-profiles/plan.md): xoá hồ sơ → chuyển `created_by` sang hồ sơ đang thao tác; avatar = chữ cái đầu + 8 màu preset; tối đa 8 hồ sơ.

> **Red-team 2026-10-01 — plan thay thế một số điểm trên:** login trả `LoginOut` tương thích ngược (không phải `SessionOut`); xoá hồ sơ cần mật khẩu gia đình, sách chuyển cho hồ sơ tạo sớm nhất còn lại; không có `?shelf=mine`; thêm `X-Profile-Id` + downgrade guard. Nguồn sự thật: [plan.md](../261001-0915-family-profiles/plan.md).
