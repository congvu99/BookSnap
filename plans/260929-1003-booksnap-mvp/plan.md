---
title: "BookSnap MVP - chụp sách thành audiobook tiếng Việt"
description: "PWA chụp trang sách trực tiếp trên web → OCR Gemini → TTS tiếng Việt → vừa đọc vừa nghe; deploy Railway (Railpack)"
status: in-progress
priority: P2
branch: "main"
tags: [pwa, fastapi, ocr, tts, vietnamese, railway]
blockedBy: []
blocks: []
created: "2026-09-29T03:03:31.362Z"
createdBy: "ck:plan"
source: skill
---

# BookSnap MVP - chụp sách thành audiobook tiếng Việt

## Overview

App cá nhân/gia đình, phi thương mại; nhiều tài khoản dùng chung 1 thư viện, mỗi người có tiến độ đọc/nghe riêng. Chụp trang sách bằng camera trình duyệt (ảnh chỉ nằm trong RAM, không lưu vào máy) → upload → Gemini Flash OCR → tách đoạn 1000–1500 ký tự → TTS (1 provider + voice cố định mỗi sách; mặc định Gemini, Azure F0 là lựa chọn thay thế) → MP3 → reader highlight đoạn đang đọc, nghe lại/offline bất cứ lúc nào.

Tải: ~100 trang/tháng (~200K ký tự, ~5h audio, ~140MB). 1 service Railway, SQLite + audio trên Volume `/data`, worker asyncio trong process.

## Quyết định kiến trúc đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Backend Python 3.12 + FastAPI, 1 process, 1 replica | Tải thấp; SQLite + worker in-process đủ dùng (YAGNI) |
| D2 | Frontend **không build step**: ES modules + Preact/htm vendored, FastAPI serve static | Railpack chỉ cần provider Python, không cần Node; ít moving parts |
| D3 | Camera: `getUserMedia` → canvas → Blob JPEG trong RAM; **không** `<input capture>` | Một số Android tự lưu ảnh vào Thư viện |
| D4 | Server không giữ ảnh lâu dài: lưu tạm `/data/tmp`, xoá ngay khi OCR thành công (TTL 24h nếu lỗi) | Không cần ảnh sau OCR; tiết kiệm Volume |
| D5 | `TtsProvider` / `OcrProvider` là interface; provider & model qua env | Free tier/preview model có thể đổi |
| D11 | **Không tự fallback giữa provider.** Mỗi sách gắn 1 provider+voice; hết quota → chunk `waiting_quota`, tự chạy tiếp khi quota hồi. Đổi sang Azure chỉ khi user chọn tay cho cả sách | Giữ giọng nhất quán trong 1 cuốn (validation) |
| D12 | Backup = export ZIP thủ công từng sách (MP3 + text) | Đơn giản, $0 (validation) |
| D6 | Chunk là đơn vị idempotent: `hash(text+provider+voice)` → cache audio | Retry/regenerate rẻ, không tốn quota |
| D7 | Azure gọi qua REST (httpx), không dùng Speech SDK | SDK native nặng, khó build với Railpack |
| D8 | Gemini trả PCM → encode MP3 bằng `lameenc` (wheel) | Tránh phụ thuộc ffmpeg hệ thống |
| D9 | Tài khoản: username + tên hiển thị + mật khẩu (argon2), **không xác thực email**; đăng ký cần `INVITE_CODE`; DB session, cookie httpOnly 180 ngày | Định danh để nhớ ai nghe dở cuốn nào; chặn người lạ đốt quota; `<audio>` tự gửi cookie ([brainstorm](./reports/brainstorm-260929-user-accounts.md)) |
| D13 | Thư viện chung, tiến độ riêng `progress(user_id, book_id)`; chỉ người tạo sách đổi giọng/xoá sách | Không OCR/TTS trùng; tránh sửa nhầm sách người khác |
| D10 | Design: [docs/design-guidelines.md](../../docs/design-guidelines.md) — Classic Library | Đã chốt với user |

## Phases

| Phase | Name | Status | Effort |
|-------|------|--------|--------|
| 1 | [Nền tảng backend, tài khoản và dữ liệu](./phase-01-backend-foundation-and-data.md) | Completed | 1.5–2 ngày |
| 2 | [Pipeline OCR và TTS](./phase-02-ocr-and-tts-pipeline.md) | Implemented — chờ PoC key thật | 1.5–2 ngày |
| 3 | [PWA camera và thư viện](./phase-03-pwa-camera-and-library.md) | Implemented — chờ test thiết bị | 1.5 ngày |
| 4 | [Reader và audio player](./phase-04-reader-and-audio-player.md) | Implemented — chờ test thiết bị | 1.5–2 ngày |
| 5 | [Deploy Railway và vận hành](./phase-05-railway-deploy-and-operations.md) | Implemented — chờ deploy | 0.5 ngày |

Tổng: ~6.5–8 ngày. Thứ tự: 1 → (2 ∥ 3) → 4 → 5. Phase 3 chỉ cần API phase 1; phase 4 cần audio thật từ phase 2. Có thể deploy sớm sau phase 2 để test camera trên HTTPS thật.

## Acceptance criteria (MVP)

- [ ] Trên điện thoại (Android Chrome + iOS Safari), chụp ≥5 trang liên tiếp, không ảnh nào xuất hiện trong Thư viện ảnh.
- [ ] 5 trang sách Việt → text đúng dấu ≥98% ký tự (kiểm tay), audio MP3 sẵn sàng < 5 phút.
- [ ] Reader phát liên tục qua các đoạn, highlight đúng đoạn, chạm đoạn để nhảy tới.
- [ ] Đóng app/mở lại → tiếp tục đúng vị trí; bật chế độ máy bay → nghe lại được sách đã tải.
- [ ] Redeploy Railway không mất sách/audio; restart giữa chừng → job tự chạy tiếp. — *restart verify bằng test; Railway chưa deploy*
- [ ] Gemini hết quota → đoạn chuyển `waiting_quota`, UI báo "Chờ quota, dự kiến tiếp tục lúc …", tự chạy tiếp khi quota hồi; không lẫn giọng trong 1 sách. — *backend verify bằng test (fake 429, claim token chống lẫn giọng); chưa gặp 429 thật*
- [x] Export 1 sách thành ZIP (MP3 + text.json) tải về được.
- [x] Đăng ký thiếu/sai mã mời bị từ chối; mọi `/api/*` (trừ register/login) trả 401 khi chưa đăng nhập.
- [ ] 2 tài khoản nghe cùng 1 sách ở 2 vị trí khác nhau; mỗi người mở lại đúng vị trí của mình; mục "Tiếp tục nghe" riêng từng người. — *API đã verify bằng test; UI 2 máy chưa verify*
- [x] User không phải người tạo không xoá/đổi giọng được sách (403).

## Dependencies

- Không có plan khác. External: Gemini API key (AI Studio), Azure Speech F0 key, tài khoản Railway Hobby ($5/tháng).

## Open questions

1. Quota free tier hiện tại của Gemini TTS/Flash và Azure F0 — kiểm tra trước phase 2.
2. Có cần highlight từng từ không? Mặc định MVP: highlight theo đoạn.

## Validation Log

### Session 1 — 2026-09-29
Questions: 4

| Chủ đề | Quyết định | Ảnh hưởng |
|---|---|---|
| TTS khi hết quota | Chờ quota reset, không tự fallback; provider+voice cố định mỗi sách, đổi tay | Phase 1 (schema `books.tts_provider/tts_voice`, `chunks.waiting_quota/not_before`, PATCH book), 2 (router), 4 (UI trạng thái), 5 (runbook) |
| Ảnh trên server | Xoá ngay sau OCR thành công (TTL 24h nếu lỗi) | Giữ nguyên D4 |
| Backup | Export ZIP thủ công từng sách | Phase 5 (`export_routes.py`, nút tải), D12 |
| Frontend | Không build, Preact/htm vendored | Giữ nguyên D2 |

### Verification Results
- Claims checked: 6 · Verified: 1 · Failed: 0 · Unverified: 5
- Tier: Full (5 phases), nhưng repo trống → mọi file là `Create`, không có symbol để đối chiếu
- Verified: `docs/design-guidelines.md` tồn tại
- Unverified (external, đã thành bước kiểm tra trong phase): Starlette `FileResponse` Range (P1 step 7), `lameenc` wheel Linux + Railpack detect/start (P5 step 1), quota Gemini/Azure (P2 step 1), getUserMedia iOS standalone (P3 risk)

### Whole-Plan Consistency Sweep
- Đã quét `TTS_PRIMARY`, `fallback`, `dự phòng`, `primary`: đổi env thành `TTS_DEFAULT_PROVIDER` (P1, P5); bỏ badge giọng dự phòng (P4); acceptance criteria cập nhật theo `waiting_quota`.
- "fallback" còn lại chỉ là SPA fallback (P3), blob fallback (P4), Dockerfile fallback (P5) — không liên quan TTS.
- Unresolved contradictions: 0

### Session 2 — 2026-09-29 (brainstorm tài khoản)
- Thay `APP_TOKEN` bằng đăng ký/đăng nhập (username + mật khẩu, không verify) + mã mời; thư viện chung, progress theo user; quyền người tạo sách. Report: [reports/brainstorm-260929-user-accounts.md](./reports/brainstorm-260929-user-accounts.md)
- Propagated: phase 1 (schema users/sessions/progress, auth routes, CLI reset), 3 (auth view, thư viện chung), 4 (progress theo user), 5 (env `INVITE_CODE`, runbook).
- Consistency sweep: không còn `APP_TOKEN`, `/api/login`, `login-view` ngoài log. Unresolved contradictions: 0

### Session 3 — 2026-09-29 (cook: implement + review)
- Implement đủ 5 phase; 102 test pass (không gọi mạng). Reports: [phase-02](./reports/phase-02-implementation-report.md), [phase-03-04](./reports/phase-03-04-web-implementation-report.md), [code-review + re-review](./reports/code-review-report.md), [tester](./reports/tester-report.md).
- Quyết định user (C2 thứ tự trang): **chờ + cho phép bỏ trang** — seq phải liên tục từ 0; trang thiếu/lỗi chặn các trang sau tới khi thử lại hoặc `POST /api/books/{id}/pages/{seq}/discard`; trang lỗi hết hạn ảnh **không** còn tự bỏ qua; upload queue dừng ở trang lỗi đầu tiên.
- Thay đổi so với plan: chunk bị TTS claim thì seal (trang thêm sau mở chunk mới); `chunks.claim_token` (migration v2) chống kết quả TTS cũ ghi đè; middleware giới hạn body trước auth; `GET /api/voices`; `railway.json` bọc start command bằng `/bin/sh -c` (Railway exec-form không expand `$PORT`).
- Còn mở: Medium/Low trong code-review-report (Re-review → "Still open"), PoC giọng + quota thật, test thiết bị, deploy Railway.

