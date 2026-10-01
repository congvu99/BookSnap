---
title: Family profiles (Netflix-style)
description: >-
  1 tài khoản gia đình → nhiều hồ sơ (tên + avatar), tiến độ/bookmark riêng, Kệ
  của tôi; gộp tài khoản cũ thành hồ sơ
status: in-progress
priority: P2
branch: feat/family-profiles
tags:
  - auth
  - profiles
  - migration
  - tdd
blockedBy: []
blocks: []
created: '2026-10-01T02:59:39.407Z'
createdBy: 'ck:plan'
source: skill
---

# Family profiles (Netflix-style)

## Overview

Thêm lớp `accounts` (login gia đình). Bảng `users` trở thành **hồ sơ** — `user_id` ở `progress`, `bookmarks`, `books.created_by` giữ nghĩa "hồ sơ", nên route nghiệp vụ không đổi chữ ký (chỉ route MeOut/password/route dùng chung đổi dependency). Session lưu `account_id` + hồ sơ đang chọn (`user_id` nullable). Thêm `shelf_items` cho "Kệ của tôi".

Nguồn: [brainstorm report](../reports/brainstorm-261001-0900-family-profiles-netflix-style.md). Mode: `--tdd`. Đã qua red-team (xem cuối file).

## Quyết định đã chốt

- 1 server = 1 gia đình; thư viện/chủ đề/audio chung. Đăng ký mở **chỉ khi chưa có account**.
- Không PIN, không hồ sơ trẻ em. Tối đa **8** hồ sơ. Avatar = chữ cái đầu + 8 màu preset (`c1`…`c8`).
- Migration: user tạo sớm nhất → login gia đình (giữ username + password_hash; `accounts.id` là id mới); mọi user → hồ sơ; session cũ giữ hồ sơ đang chọn.
- Quyền sách giữ `ensure_book_owner` (hồ sơ tạo sách).
- Xoá hồ sơ: **cần mật khẩu gia đình**; sách/chủ đề chuyển cho **hồ sơ tạo sớm nhất còn lại**; không xoá được hồ sơ đang dùng hoặc hồ sơ cuối.
- Response login/register tương thích ngược (MeOut top-level + `account` + `profile_required`).
- Client gửi `X-Profile-Id`; lệch session → `409 profile_mismatch`.
- Logout giữ tiến độ local của các hồ sơ.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [DB migration accounts and profiles](./phase-01-db-migration-accounts-and-profiles.md) | Completed |
| 2 | [Account auth and profile session](./phase-02-account-auth-and-profile-session.md) | Completed |
| 3 | [Profiles and shelf API](./phase-03-profiles-and-shelf-api.md) | Completed |
| 4 | [Web profile picker and shelf](./phase-04-web-profile-picker-and-shelf.md) | Completed |
| 5 | [Docs and rollout](./phase-05-docs-and-rollout.md) | In Progress |

Tuyến tính 1 → 5. Phase 1 bước 0 (downgrade guard) merge + deploy `main` **trước**; phần còn lại trên `feat/family-profiles`, merge khi suite xanh. Effort tổng ≈ **4,5 ngày** (tăng từ 3 ngày sau red-team).

## Acceptance criteria (toàn plan)

1. Login 1 lần → chọn A, nghe tới đoạn 5 → đổi B thấy tiến độ B → về A vẫn đoạn 5.
2. A thêm sách vào kệ → chỉ kệ A có; thư viện chung vẫn đủ.
3. DB cũ 3 user → 1 login + 3 hồ sơ, đủ progress/bookmark, session cũ vẫn sống.
4. B không xoá được sách A chụp (403).
5. Chưa chọn hồ sơ → `409 profile_required` → client hiện picker (cả khi cold boot, không rơi vào offline).
6. Đã có account → đăng ký `403 registration_closed`, UI ẩn tab Đăng ký.
7. 2 tab cùng trình duyệt: đổi hồ sơ ở tab này không làm tab kia ghi tiến độ vào hồ sơ mới.
8. Xoá hồ sơ cần mật khẩu gia đình; sách chuyển cho hồ sơ tạo sớm nhất còn lại.
9. Image cũ chạy trên DB v6 → crash rõ ràng (guard), không chạy sai âm thầm.
10. `pytest -q` và `node --test "tests/web/**/*.test.mjs"` xanh.

## Dependencies

Không trùng plan đang mở.

## Red Team Review

### Session — 2026-10-01
**Findings:** 15 (15 accepted, 0 rejected) — gộp từ 28 finding của 3 reviewer (Security Adversary, Failure Mode Analyst, Assumption Destroyer). Bị loại khi gộp: SW post-message ép reload (không cần nhờ response tương thích), chặn logout khi offline (thay bằng RT#14).
**Severity breakdown:** 2 Critical, 7 High, 6 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `deploy.sh` auto-rollback image cũ trên DB v6, health vẫn xanh | Critical | Accept | Completed |
| 2 | Login `SessionOut` vỡ `auth-view.js`/client cũ; thiếu auth-view, account-view | Critical | Accept | Completed |
| 3 | Boot `/api/me` 409 rơi nhánh offline | High | Accept | Completed |
| 4 | Hồ sơ trên cookie dùng chung → tab ghi nhầm hồ sơ | High | Accept | Completed |
| 5 | Xoá hồ sơ không cần mật khẩu; sách chuyển cho người xoá | High | Accept (user chọn: mật khẩu + heir = hồ sơ sớm nhất) | In Progress |
| 6 | Runner không ROLLBACK khi lỗi giữa chừng; `accounts.id`; SQLite prod | High | Accept | Phase 1, Phase 5 |
| 7 | Suite đỏ trên main; test file bị sót; fixture bob | High | Accept | Phase 1 (branch), Phase 2 |
| 8 | MeOut cần account; rate-limit mật khẩu theo hồ sơ | High | Accept | Phase 2 |
| 9 | CLI `reset-password` bắt buộc sửa + 6 chỗ docs | High | Accept | Phase 2, Phase 5 |
| 10 | Xoá hồ sơ đang dùng → FK 500; mất ảnh trong upload queue | Medium | Accept | Phase 2, Phase 3, Phase 4 |
| 11 | `_SUMMARY_SQL` named params vỡ 3 caller; `list_summaries`; `on_shelf`; bỏ `?shelf=mine` | Medium | Accept | Phase 3 |
| 12 | Đăng ký không atomic | Medium | Accept | Phase 2 |
| 13 | voices/usage/audio bị 409 khi chưa chọn hồ sơ | Medium | Accept | Phase 2 (bảng route → dependency) |
| 14 | Logout xoá tiến độ chưa sync của mọi hồ sơ | Medium | Accept | Phase 4 |
| 15 | Rollout: không có runbook restore, bước rollback không chạy được | Medium | Accept | Phase 5 |

### Whole-Plan Consistency Sweep
- Decision delta: `SessionOut` → `LoginOut` tương thích; bỏ `?shelf=mine`; heir = hồ sơ sớm nhất (không phải actor); DELETE profile có `{password}`; logout không xoá tiến độ; voices/usage/audio → `CurrentAccount`; branch `feat/family-profiles`; effort 3 → 4,5 ngày.
- Đã rà `plan.md` + 5 phase: không còn `SessionOut`, `shelf=mine` (chỉ còn ở câu "không thêm"), `created_by=:actor`, `clearAllProgress`, `BookRepository.list(`; brainstorm report đã ghi chú bị thay thế bởi plan.
- Unresolved: 0.
