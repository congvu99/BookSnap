---
phase: 2
title: Account auth and profile session
status: completed
priority: P1
effort: 1.25d
dependencies:
  - 1
---

# Phase 2: Account auth and profile session

## Overview
Login/đăng ký/đổi mật khẩu/CLI chuyển sang `accounts`. Session = account + hồ sơ đang chọn. Thêm tạo/liệt kê/chọn hồ sơ. Viết lại fixture test để `alice`/`bob` là 2 hồ sơ cùng gia đình. Kết thúc phase: suite xanh trên branch.

## Requirements
- `POST /api/auth/register` chỉ khi chưa có account + đúng `INVITE_CODE`; tạo account + hồ sơ đầu + session (đã chọn) trong **1 `db.transaction()`** — lỗi bất kỳ → không còn account nào, đăng ký vẫn mở [RT#12]. Kiểm "chưa có account" bên trong transaction. Đã có → `403 registration_closed`. Xoá `UsernameTakenError` khỏi `user_repository`.
- `GET /api/auth/status` (public) → `{registration_open: bool}`.
- `POST /api/auth/login` xác thực `accounts`; đúng 1 hồ sơ → tự chọn.
- **Response login/register tương thích ngược [RT#2]:** `LoginOut = MeOut fields (khi đã chọn hồ sơ, else null) + account + profile_required: bool` — client cũ (SW cache) đọc `id`/`display_name` như trước.
- `GET /api/profiles`, `POST /api/profiles` `{display_name, avatar?}` (cần account; quá 8 → `409 profile_limit`; avatar ngoài `^c[1-8]$` → `400 avatar_invalid`).
- `POST /api/profiles/{id}/select` → **1 câu SQL** `UPDATE sessions SET user_id=:p WHERE token_hash=:t AND EXISTS(SELECT 1 FROM users WHERE id=:p AND account_id=:a)`; rowcount 0 → 404 [RT#10]. Trả `MeOut`.
- `require_user`: không session → 401; chưa chọn → `409 profile_required`; header `X-Profile-Id` có mặt mà ≠ `sessions.user_id` → `409 profile_mismatch` (vắng header = chấp nhận, để client cũ chạy) [RT#4].
- FK `IntegrityError` khi ghi bảng thuộc hồ sơ (progress, bookmarks, books.created_by, topics.created_by) → `409 profile_required` thay vì 500 [RT#10]. Làm ở 1 chỗ: exception handler cho `sqlite3.IntegrityError` có "FOREIGN KEY" trong `app/api_errors.py`.
- `POST /api/me/password` dùng account: verify `accounts.password_hash`, rate-limit key `password:{account.id}`, revoke mọi session khác của account [RT#8].
- CLI `reset-password <account-username>`: tìm trong `accounts`, đổi hash, revoke **mọi** session của account; username không có → thông báo nêu rõ "dùng username tài khoản gia đình" [RT#9].
- Log: `auth_login outcome=ok account_id=…`, `profile_selected account_id=… profile_id=…`.

## Route → dependency [RT#13]

| Dependency | Routes |
|---|---|
| public | `/api/auth/register`, `/login`, `/logout`, `/status` |
| `CurrentAccount` (không cần hồ sơ) | `/api/profiles*` (list/create/select), `/api/me/password`, `/api/voices*`, `/api/usage*`, `/api/audio/*` (audio chunk dùng chung, SW prefetch không bị 409) |
| `CurrentUser` (cần hồ sơ) | `/api/me`, `PATCH /api/me`, `/api/me/profile`, `/api/me/continue`, books/pages/progress/bookmarks/topics/export, shelf (Phase 3), `DELETE /api/profiles/{id}` (Phase 3) |

Kiểm lại từng file trong `app/api/` khi implement; route nào không đọc `user.id` → `CurrentAccount`.

## Architecture

```python
@dataclass(frozen=True)
class Account: id: str; username: str; password_hash: str; created_at: str
@dataclass(frozen=True)
class User:    id: str; account_id: str; display_name: str; avatar: str; created_at: str   # = hồ sơ
@dataclass(frozen=True)
class SessionContext: token_hash: str; account: Account; user: User | None

SessionService.create(account_id, user_id | None) -> token
SessionService.resolve(token) -> SessionContext | None
SessionService.select_profile(ctx: SessionContext, user_id) -> bool

CurrentAccount = Annotated[SessionContext, Depends(require_account)]   # 401
CurrentUser    = Annotated[User, Depends(require_user)]                # 409 profile_required / profile_mismatch
```

`require_user` lưu `request.state.session` để route MeOut lấy account [RT#8]:

```text
MeOut      = {id, username(=account username), display_name, avatar}   # MeOut.of(account, user)
ProfileOut = {id, display_name, avatar}
LoginOut   = {...MeOut | null fields, account: {id, username}, profile_required: bool}
```

`PATCH /api/me` giữ (đổi tên hồ sơ hiện tại; `account-profile-forms.js` đang dùng). Routes nghiệp vụ dùng `user.id` giữ nguyên chữ ký; chỉ các route MeOut + password + các route chuyển sang `CurrentAccount` đổi.

## Related Code Files
- Create: `app/repositories/account_repository.py`, `app/api/profiles_routes.py`, `tests/test_profiles_session_api.py`
- Modify: `app/repositories/user_repository.py` (bỏ `get_by_username`, `update_password_hash`, `UsernameTakenError`; thêm `create(conn, account_id, display_name, avatar)`, `list_for_account`, `count_for_account`), `app/repositories/session_repository.py` (`account_id`, `select`, `delete_for_account[_except]`, dùng `row_to`), `app/auth/session_service.py`, `app/auth/current_user.py`, `app/auth/auth_routes.py`, `app/api/account_routes.py`, `app/api_errors.py` (FK handler), `app/api/voices_routes.py`, `app/api/usage_routes.py`, `app/api/audio_routes.py`, `app/cli.py`, `app/app_context.py`, `app/main.py`
- Modify tests: `tests/conftest.py`, `tests/test_auth_api.py` (bỏ `username_taken`; case-insensitive login; `SELECT password_hash FROM accounts`; CLI tests), `tests/test_account_api.py` (số session bị revoke với bob cùng account), `tests/test_tts_router.py`, `tests/test_usage_quota.py`, `tests/test_worker_resume.py` (thay `get_by_username` bằng fixture id) [RT#7]

## Implementation Steps (TDD)
1. **`tests/conftest.py` trước:**
   - `register(app, "alice", "Alice Nguyễn")` → account + hồ sơ Alice.
   - `login_and_select(app, profile_id, username="alice") -> client`: client mới login account + select hồ sơ.
   - `add_profile(app, owner_client, display_name) -> (client, profile_id)`: owner `POST /api/profiles`, rồi `login_and_select`.
   - Fixture `bob` = hồ sơ thứ 2 cùng gia đình; fixture `alice_id`/`bob_id` thay `ctx.users.get_by_username`.
2. **Test đỏ:**
   - đăng ký lần 2 → 403 `registration_closed`; `/status` `true → false`; ép insert profile lỗi → 0 account, `/status` vẫn `true`.
   - 2 register đồng thời → đúng 1 thành công.
   - login 1 hồ sơ → body có `id`, `display_name` top-level, `profile_required=false`; 2 hồ sơ → `profile_required=true`, `/api/me` → 409 `profile_required`; select → 200.
   - select id lạ → 404; tạo hồ sơ thứ 9 → 409; avatar `c9` → 400.
   - 2 client chung 1 cookie jar: A select B, client kia gửi `X-Profile-Id: A` → 409 `profile_mismatch` [RT#4].
   - progress alice/bob độc lập trong cùng account.
   - `/api/voices`, `/api/usage`, audio chunk chạy khi chưa chọn hồ sơ.
   - đổi mật khẩu: session khác của account bị revoke (gồm session bob), session hiện tại sống; rate-limit chung cho alice + bob.
   - CLI `reset-password alice` đổi hash account + revoke mọi session; `reset-password khongco` báo lỗi rõ.
3. Implement repositories → session service → dependencies → error handler → routes → CLI.
4. `pytest -q` toàn bộ; **không** nới assertion.

## Success Criteria
- [ ] `pytest -q` xanh toàn bộ trên branch.
- [ ] Login response chứa `id`, `display_name` khi đã chọn hồ sơ (contract test).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Fixture `bob` mới làm sai ý nghĩa test cũ | M | M | `login_and_select`; cập nhật số revoke tường minh; review diff test |
| Client cũ (SW cache) sau deploy | M | M | Response tương thích ngược [RT#2]; client cũ với nhiều hồ sơ: `id` null → Phase 5 báo cả nhà mở lại app 2 lần để SW cập nhật |
| Lộ timing account tồn tại | L | L | Giữ `verify_password(None, …)` |
