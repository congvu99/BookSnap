---
phase: 3
title: Profiles and shelf API
status: completed
priority: P2
effort: 0.75d
dependencies:
  - 2
---

# Phase 3: Profiles and shelf API

## Overview
Sửa/xoá hồ sơ ("Quản lý hồ sơ") và "Kệ của tôi". Mọi thao tác hồ sơ giới hạn trong account của session.

## Requirements
- `PATCH /api/profiles/{id}` `{display_name?, avatar?}` → `ProfileOut`. Hồ sơ nào trong account cũng sửa được. Validate như Phase 2.
- `DELETE /api/profiles/{id}` body `{password}` → 204 [RT#5]:
  - verify `accounts.password_hash`; sai → `403 password_invalid`; rate-limit chung key `password:{account.id}`;
  - hồ sơ đang chọn ở session hiện tại → `409 profile_active`; hồ sơ cuối → `409 last_profile`; khác account → 404;
  - trong 1 `db.transaction()`: heir = hồ sơ **tạo sớm nhất còn lại** (≠ hồ sơ bị xoá); `UPDATE books SET created_by=:heir`, `UPDATE topics SET created_by=:heir`; `DELETE users` → CASCADE progress/bookmarks/shelf; sessions đang dùng hồ sơ đó → `user_id` SET NULL.
- `PUT /api/me/shelf/{book_id}` → 204 (idempotent, `INSERT OR IGNORE`); sách không tồn tại → 404.
- `DELETE /api/me/shelf/{book_id}` → 204 (idempotent).
- Mọi book summary có `on_shelf: bool`. **Không** thêm `?shelf=mine` — client lọc theo `on_shelf` [RT#11].
- Log `profile_deleted account_id=… profile_id=… heir_id=… books_reassigned=N`.

## Architecture
- `ShelfRepository`: `add`, `remove`.
- `_SUMMARY_SQL` (`app/repositories/book_repository.py`): thêm `LEFT JOIN shelf_items si ON si.book_id = b.id AND si.user_id = :u`, cột `(si.user_id IS NOT NULL) AS on_shelf`. Chuyển **toàn bộ** sang named params vì sqlite3 không cho trộn `?` và `:name` [RT#11]:
  - `list_summaries(user_id)` → `{"u": …}`
  - `get_summary(book_id, user_id)` → `WHERE b.id = :book_id`
  - `list_in_progress_for_user(user_id, limit)` → `LIMIT :limit`
- `BookSummary` thêm field `on_shelf: bool` (vì `row_to` bỏ cột không khai báo). Serializer (`app/api/serializers.py`) xuất `on_shelf`. `app/api/export_routes.py` dùng `get_summary` → chạy lại test export.
- Độ phức tạp: JOIN theo PK `(user_id, book_id)`, O(n) sách.

## Related Code Files
- Create: `app/repositories/shelf_repository.py`, `app/api/shelf_routes.py`, `tests/test_shelf_api.py`
- Modify: `app/api/profiles_routes.py`, `app/repositories/user_repository.py` (`delete_with_heir(conn, profile_id)` trả heir + số sách), `app/repositories/book_repository.py` (3 method + `BookSummary`), `app/api/serializers.py`, `app/api/export_routes.py` (chỉ kiểm), `app/app_context.py`, `app/main.py`
- Modify tests: `tests/test_profiles_session_api.py`

## Implementation Steps (TDD)
1. **Test đỏ — kệ:** alice thêm sách → `on_shelf` true với alice, false với bob (list, detail, continue); PUT 2 lần vẫn 204; xoá sách → dòng kệ mất (CASCADE); sách random → 404.
2. **Test đỏ — hồ sơ:**
   - đổi tên/avatar;
   - xoá thiếu/sai mật khẩu → 400/403; đúng → 204;
   - account có alice (sớm nhất), bob, carol: carol xoá bob → sách bob chuyển cho **alice** (không phải carol); progress/bookmark/kệ bob mất; session bob → `/api/me` 409;
   - xoá chính mình → 409 `profile_active`; hồ sơ account khác (insert trực tiếp) → 404;
   - request cũ của bob sau khi xoá (PUT progress) → 409, không 500 [RT#10].
3. Implement repository → routes → SQL summary.
4. `pytest -q` toàn bộ (gồm export, continue listening). Xanh → merge branch vào `main` (hoặc tiếp Phase 4 cùng branch).

## Success Criteria
- [ ] `pytest -q` xanh.
- [ ] Acceptance #2, #4 có test.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Chuyển named params làm vỡ detail/export/continue | M | H | Liệt kê đủ 3 method; test hiện có phủ [RT#11] |
| Xoá nhầm hồ sơ mất tiến độ | L | M | Bắt mật khẩu gia đình + hộp xác nhận (Phase 4) [RT#5] |
| Topic FK chặn DELETE users | H | M | Reassign topics trước DELETE trong cùng transaction |
