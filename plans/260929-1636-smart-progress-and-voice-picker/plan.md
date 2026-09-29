---
title: Tiến trình xử lý thông minh + chọn/nghe thử giọng + giọng nam mặc định
description: >-
  Màn tiến trình có %/ETA/đếm ngược chờ trang + nút đọc luôn, thư viện tự cập
  nhật, báo số trang khi chụp, chọn + nghe thử giọng lúc thêm nội dung, mặc định
  Charon.
status: in-progress
priority: P2
branch: main
tags:
  - frontend
  - api
  - tts
  - ux
blockedBy: []
blocks: []
created: '2026-09-29T09:43:38.569Z'
createdBy: 'ck:plan'
source: skill
mode: tdd
---

# Tiến trình xử lý thông minh + chọn/nghe thử giọng + giọng nam mặc định

## Overview

Nguồn: [brainstorm report](../reports/brainstorm-260929-1636-smart-progress-and-voice-picker.md) (D1–D9) + Red Team Review bên dưới.

- User không biết app đang làm gì sau khi chụp. Nguyên nhân gốc: chunk tail chờ `tail_seal_grace_seconds` (90s), trong khi API đếm `pending` vào `chunks.processing`. → Phase 1 + 6.
- Giọng mặc định chuyển `Kore` (nữ) sang `Charon` (nam, trầm), **sau khi user nghe PoC ở Gate 0**. Style prompt giữ nguyên, sách cũ giữ giọng. → Phase 1.
- Chọn + nghe thử giọng ở mọi lối vào camera. Đổi giọng chỉ áp dụng cho các đoạn chưa có audio, qua endpoint mới `PUT /api/books/{id}/voice`. Bỏ mục đổi giọng trong cài đặt sách (chỉ ở UI). → Phase 2, 3, 4.
- Mỗi ảnh = 1 trang; mỗi trang upload xong có báo số trang. → Phase 5.
- Thư viện tự cập nhật sách đang xử lý. → Phase 7.

**TDD:** mỗi phase gồm Tests Before (khóa hành vi hiện tại), Tests New (đỏ), Implement, Regression Gate.
- Backend: `.venv/Scripts/python -m pytest -q`.
- Frontend: logic thuần tách ra module không import Preact, test bằng `node --test "tests/web/**/*.test.mjs"` (Node ≥22.7, không thêm dependency, chạy tay vì repo chưa có CI).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend tail waiting seal tail and default voice](./phase-01-backend-tail-waiting-seal-tail-and-default-voice.md) | Completed |
| 2 | [Backend voice change for new content only](./phase-02-backend-voice-change-for-new-content-only.md) | Completed |
| 3 | [Backend voice preview endpoint](./phase-03-backend-voice-preview-endpoint.md) | Completed |
| 4 | [Frontend voice picker and book choose step](./phase-04-frontend-voice-picker-and-book-choose-step.md) | Completed |
| 5 | [Frontend capture page notifications](./phase-05-frontend-capture-page-notifications.md) | Completed |
| 6 | [Frontend processing progress view](./phase-06-frontend-processing-progress-view.md) | Completed |
| 7 | [Frontend library live progress](./phase-07-frontend-library-live-progress.md) | Completed |
| 8 | [Docs env service worker and voice PoC](./phase-08-docs-env-service-worker-and-voice-poc.md) | In Progress |

Thứ tự:
1. Phase 1 bắt đầu bằng **Gate 0: PoC giọng**. Chưa chốt giọng thì không làm tiếp.
2. Phase 1 → 2 → 3 chạy tuần tự (cùng đụng `books_routes.py`/`book_repository.py`/`voices_routes.py`).
3. Phase 4 cần 2 + 3. Phase 5 cần 4 (cùng sửa `capture-view.js`).
4. Phase 6 cần 1 (+ `StatusToast` của 5). Phase 7 cần helper của 6.
5. Phase 8 làm cuối.

## Dependencies

- **Precondition (bắt buộc):** working tree có WIP account + usage/quota **chưa commit**. WIP này sửa `worker.py`, `tts_router.py`, `main.py`, `db.py` (migration `provider_usage`), `config.py`, `library-view.js`, `sw.js`, `api-client.js`. Phải commit WIP trước phase 1. Preview (phase 3) ghi usage qua `ProviderUsageRepository` của WIP.
- **Không có migration DB** trong plan này.
- `260929-1003-booksnap-mvp` (in-progress): phạm vi rộng, không chặn nhau.

## Acceptance Criteria

1. Giọng mặc định đã được user nghe và chốt (Gate 0). Sách mới không chọn giọng → dùng giọng đó. Sách cũ giữ `Kore`, không regenerate. Style prompt không đổi.
2. Mọi lối vào camera (sách mới, sách có sẵn, "Thêm trang", deep link) đều qua bước chọn hoặc xác nhận giọng. ▶ phát ngay trong tap đầu (kể cả iOS).
3. Preview:
   - Voice ngoài whitelist → 404; chưa đăng nhập → 401; provider chưa cấu hình → 409.
   - Không nhận text từ client.
   - Request đồng thời chỉ tạo 1 lần gọi provider, kể cả khi lỗi.
   - Lỗi được cache; có rate limit theo user; có ghi usage; lỗi không lộ text của provider.
4. `PUT /api/books/{id}/voice`: chunk `done` giữ giọng cũ, đoạn chưa có audio dùng giọng mới, không reset grace. PATCH cũ giữ nguyên hành vi. Voice lạ → 400, provider chưa cấu hình → 409. SSML của Azure luôn escape tên voice.
5. Player-sheet không còn mục đổi giọng; hiện giọng của đoạn đang phát.
6. Màn camera: thumbnail có "Trang N"; mỗi trang upload xong có toast đúng số trang; topbar "Đã tải x/y".
7. Màn tiến trình:
   - % không giảm.
   - Chỉ báo "chờ thêm trang" khi `queued=0`.
   - Lỗi và quota luôn hiện ra.
   - "Xong rồi, đọc luôn" bấm được bởi mọi thành viên, tail được TTS ngay, idempotent.
   - Nút nghe hiện khi `chunks.done ≥ 1`.
   - Có danh sách trang kèm trạng thái.
8. Text sửa tay không bao giờ bị chunker ghi đè (guard `sealed=0`).
9. Thư viện tự cập nhật (5s, còn quota thì 60s). Dừng khi tab ẩn, offline hoặc hết việc. Không trùng class với thanh tiến độ nghe.
10. `pytest -q`, `node --test` và `test_service_worker_assets.py` xanh.

## Red Team Review

4 reviewer (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic), mức verification Full. Reports: [reports/](./reports/).

Tổng 38 phát hiện. Sau khi gộp trùng còn 15; nhận 14 (1 mục do user quyết), bỏ 3 đề xuất phụ.

| # | Mức | Phát hiện | Quyết định | Phase |
|---|---|---|---|---|
| 1 | High | `tail_waiting` báo chờ khi còn đoạn khác đang synth (`book_repository.py:91`, `chunk_repository.py:122-131`) | Nhận: thêm `chunks.queued`; `phaseOf` tính từ các bộ đếm | Completed |
| 2 | High | "Thêm trang" bỏ qua picker (`book-status-view.js:152`, `capture-view.js:12`); đổi giọng trước khi camera chạy | Nhận: bước `confirm`; chỉ đổi giọng sau `cam.start()` | Completed |
| 3 | High | Rollback: `regenerate:false` bị server cũ bỏ qua → requeue cả sách (`books_routes.py:31-35`) | Nhận: endpoint `PUT /voice` | Completed |
| 4 | High | Lời hứa "trang cũ giữ giọng cũ" sai: giọng gán lúc claim (`chunk_repository.py:114-116`) | Nhận: đổi lời thành "đoạn đã có audio" | Completed |
| 5 | High | Preview đốt quota: không cache lỗi, lock chờ 180s, limiter chung chặn UI (`worker.py:65-72`) | Nhận: single-flight + cache lỗi + rate limit theo user + timeout; bỏ refactor lifespan | Completed |
| 6 | Med | `Retry-After` float → 500; lộ text provider (`tts_gemini.py:84`, `api_errors.py:30`) | Nhận | Completed |
| 7 | Med | Chèn SSML ở Azure (`tts_azure.py:22`); provider chưa cấu hình vẫn được nhận | Nhận: `quoteattr`, 400/409, cờ `configured` | Completed |
| 8 | Med | Đổi giọng bump `updated_at` → reset grace (`book_repository.py:149`) | Nhận | In Progress |
| 9 | Med | URL preview không version + `max-age` 24h → nghe bản cũ | Nhận: `preview_url?v=` | 3, 4 |
| 10 | Med | Nghe thử bằng blob: mất user-gesture iOS, revoke URL mâu thuẫn, 503 offline báo sai (`sw.js:131-139`) | Nhận: `audio.src` + `play()` trong tap, map lỗi theo code | 4 |
| 11 | Med | Race sửa text đang **mất dữ liệu** hôm nay (`chunk_repository.py:46-52,85`) | Nhận: guard `sealed=0` + test | 1 |
| 12 | Med | ETA reset theo pha nên gần như không hiện (`worker.py:116-119`) | Nhận: ETA đơn giản, không reset | 6 |
| 13 | Med | Làm thừa: gom toast, rung thêm, thanh con, thu gọn danh sách, CTA trùng, animation, trùng `.rec-progress`, poll quota 5s | Nhận: cắt hoặc gộp | 5, 6, 7 |
| 14 | Med | PoC giọng làm cuối (script chưa có Charon, `voice_poc.py:32`); style mới đổi giọng sách Kore cũ (`tts_router.py:22-25`) | Nhận: Gate 0 ở đầu phase 1, giữ style cũ | 1, 8 |
| 15 | Med | Seal-tail chỉ owner trong khi mọi thành viên thêm, bỏ, thử lại trang được (`pages_routes.py:43,74,89`) | **User chọn: mọi thành viên** | 1, 6 |

**Bỏ:**
- Chia sẻ trạng thái pause quota của worker: phức tạp; cache lỗi của preview đã đủ.
- Gộp 8 phase còn 4: chỉ là hình thức.
- Upload nền xong sau khi sách đã ready: rủi ro thấp, chấp nhận.

**Sửa claim sai của plan cũ:** import vòng `worker.py:42` → `AppContext` là chắc chắn xảy ra. Không còn liên quan vì plan mới không dùng chung `RpmLimiter`.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 … phase-08.
- Decision deltas checked: 14, gồm:
  - `regenerate` → `PUT /voice`
  - bỏ `tail_ready_at`
  - thêm `queued`
  - 422 → 400
  - seal cho mọi thành viên
  - bỏ limiter chung, bỏ blob/objectURL, bỏ EMA
  - giữ style
  - PoC lên đầu
  - `.rec-build-progress`
  - bỏ collapse/sub-bars/animation
  - gộp CTA
  - phase 5 phụ thuộc phase 4
- Reconciled stale references: xem kết quả grep ở phần trả lời cho user.
- Unresolved contradictions: 0.
