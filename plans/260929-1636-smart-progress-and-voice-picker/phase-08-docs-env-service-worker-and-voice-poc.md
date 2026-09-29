---
phase: 8
title: Docs env service worker and voice PoC
status: in-progress
priority: P2
dependencies:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
effort: S
---

# Phase 8: Docs, env, service worker, QA trên thiết bị

## Overview
Chốt phần vận hành: đồng bộ env giữa local và Railway, bump cache service worker, cập nhật docs, QA trên thiết bị thật. PoC giọng đã chuyển lên Gate 0 của phase 1. <!-- Red Team: PoC lên đầu -->

## Requirements
- **Env:**
  - `.env.example`: `GEMINI_TTS_VOICE=<giọng chốt>`. Style giữ nguyên, trừ khi Gate 0 đã đổi.
  - README: cập nhật bảng biến môi trường.
  - **Railway:** kiểm tra `GEMINI_TTS_VOICE` (`railway variables`). Nếu đang set `Kore` thì sẽ đè default mới. **Hỏi user trước khi đổi** vì đây là prod.
- **Service worker:**
  - Bump `SHELL_CACHE` thêm 1 so với giá trị sau WIP.
  - `SHELL_ASSETS` đã được bổ sung ở từng phase; `test_service_worker_assets.py` phải xanh.
  - Đã xác nhận `/api/*` là network-first (`sw.js:161-164`), nên preview không bị SW cache.
- **Docs** (đọc bản hiện có trước khi sửa, giữ ngắn):
  - `docs/system-architecture.md`:
    - Field `chunks.queued/tail_waiting/tail_wait_seconds`.
    - `POST seal-tail` (mọi thành viên).
    - `PUT voice`, validate 400/409, escape SSML.
    - `GET voices/.../preview` (single-flight, cache lỗi, rate limit theo user, `DATA_DIR/voice-previews/`).
    - Guard `sealed=0` trong `replace_tail`.
  - `docs/codebase-summary.md`: module mới.
  - README mục Test: `node --test "tests/web/**/*.test.mjs"` (Node ≥22.7, không cần package.json). <!-- Red Team: Node 22.7 -->
  - `docs/project-roadmap.md`: đánh dấu các mục đã xong, ghi lỗ chèn SSML (M1) đã được sửa.

## Implementation Steps
1. **Regression Gate:** `pytest -q` và `node --test "tests/web/**/*.test.mjs"` xanh.
2. Cập nhật env, README, docs.
3. Bump SW, chạy `pytest tests/test_service_worker_assets.py`.
4. **QA thiết bị thật** (HTTPS):
   - iOS Safari: nghe thử phát ngay lần tap đầu; màn `confirm`; toast trang; đếm ngược; "Xong rồi, đọc luôn" bằng tài khoản không phải chủ sách.
   - Android Chrome: như trên.
   - PWA đã cài: cache mới thay cache cũ.
5. Chạy `/ck:code-review` trên toàn bộ diff trước khi commit.

## Success Criteria
- [ ] Env Railway khớp default mới (sau khi user đồng ý).
- [ ] Docs khớp với code.
- [ ] Toàn bộ test xanh; QA iOS và Android đạt.

## Risk Assessment
- **Env prod đè default:** đã có bước kiểm tra riêng.
- **Client PWA cũ:** backend chỉ thêm field (additive), PATCH giữ nguyên hành vi, endpoint mới không ảnh hưởng client cũ.
- **Rollback:** revert commit. Không có migration. File cache preview có thể xoá tay.
