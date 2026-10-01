---
phase: 5
title: Docs and rollout
status: in-progress
priority: P2
effort: 0.5d
dependencies:
  - 4
---

# Phase 5: Docs and rollout

## Overview
Docs khớp hành vi mới; triển khai an toàn (migration một chiều → backup + runbook restore đã tập dượt).

## Requirements
- Docs khớp code: schema, luồng auth, bảng API, route → dependency, mô hình hồ sơ, CLI.
- Rollout: guard đã có trên prod; kiểm SQLite trong image prod; restore được tập dượt.

## Related Code Files
- Modify docs:
  - `docs/system-architecture.md`: schema v6, auth account → session → hồ sơ, `409 profile_required`/`profile_mismatch`, header `X-Profile-Id`, API `/api/auth/status`, `/api/profiles*` (DELETE cần mật khẩu), `/api/me/shelf/*`, `on_shelf`; "`user_id` = id hồ sơ"; `ensure_book_owner` chỉ chống nhầm; downgrade guard.
  - `docs/codebase-summary.md` (mô tả + CLI ~dòng 15), `docs/project-roadmap.md` (+ CLI ~dòng 43), `docs/project-overview-pdr.md`, `docs/code-standards.md` (~dòng 19), `docs/deployment-guide.md` (~dòng 177), `docs/deployment-vps-guide.html` (~dòng 575) — chỗ nhắc `reset-password` đổi thành "`reset-password <username tài khoản gia đình>`" [RT#9].
  - `README.md`: mở đầu; "Chạy local" (đăng ký lần đầu = tạo tài khoản gia đình, thêm hồ sơ trong app); bảng sự cố "Không đăng ký được" (đã có tài khoản); CLI (~dòng 90, 98).
  - Runbook restore [RT#15] trong `docs/deployment-vps-guide.html` (và `docs/deployment-guide.md` cho Railway).

## Implementation Steps
1. Cập nhật docs (đọc trước khi sửa; kiểm link/ngày).
2. **Trước deploy:**
   1. Xác nhận guard (Phase 1 bước 0) đang chạy trên prod.
   2. Kiểm SQLite image prod: `docker compose run --rm app python -c "import sqlite3;print(sqlite3.sqlite_version)"` ≥ 3.26 [RT#6].
   3. Lấy bản sao DB prod về, chạy migration **trong image mới** → đối chiếu số dòng `users/progress/bookmarks/books`; `PRAGMA foreign_key_check` rỗng.
   4. Tập dượt restore trên máy local theo runbook bên dưới.
3. **Deploy:** `deploy/deploy.sh` (tự chạy `backup.sh` khi app đang chạy — không cần backup tay). Log phải có `db_migrate version=6`.
   - Ghi chú: backup chụp lúc app cũ còn chạy → tiến độ ghi trong vài giây trước khi swap có thể mất nếu phải restore; chấp nhận.
   - Nếu image mới unhealthy: `deploy.sh` rollback image → image cũ có guard sẽ crash ("rollback ALSO unhealthy") → làm restore.
4. **Kiểm sau deploy:** `COUNT(accounts)=1`, `COUNT(users)` = trước, progress/bookmarks ≈ trước; `/health` ok; thiết bị đang đăng nhập vào thẳng thư viện; login bằng username sớm nhất → picker đủ hồ sơ.
5. Chạy `python -m app.cli reset-password <username gia đình>` **chỉ nếu** không ai nhớ mật khẩu — xác nhận trước khi báo cả nhà [RT#9].
6. Báo cả nhà: đăng nhập bằng tài khoản gia đình; mật khẩu riêng cũ hết hiệu lực; mở lại app 2 lần để cập nhật giao diện.

### Runbook restore [RT#15]
```bash
docker compose stop app
# giải nén bản backup mới nhất (deploy/backup.sh) vào volume /data:
#   booksnap.db ← .backup-snapshot.db, library/ giữ nguyên
rm -f /data/booksnap.db-wal /data/booksnap.db-shm
git reset --hard <prev_tag>             # không dùng deploy.sh (nó ff-merge origin)
IMAGE_TAG=<prev_tag> docker compose up -d
curl -fsS https://<domain>/health
```
Lệnh cụ thể (đường dẫn volume, tên file backup) ghi theo `deploy/backup.sh` khi viết docs; tập dượt ở bước 2.4.

7. `/ck:journal`.

## Success Criteria
- [ ] Docs không còn "mỗi người 1 tài khoản"; 6 chỗ CLI đã sửa.
- [ ] Restore đã tập dượt thành công local.
- [ ] Prod: progress/bookmarks ≈ trước migration; không ai bị đăng xuất.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Không ai nhớ mật khẩu tài khoản sớm nhất | M | M | CLI reset đã sửa + test [RT#9] |
| Auto-rollback trên DB v6 | M | H | Guard + runbook restore [RT#1, RT#15] |
| SQLite prod quá cũ | L | H | Kiểm version + chạy migration trong image prod |
| Thành viên không biết login mới | H | L | Session cũ vẫn sống; báo trước |
