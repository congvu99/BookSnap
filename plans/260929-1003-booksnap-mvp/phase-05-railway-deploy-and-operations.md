---
phase: 5
title: "Deploy Railway và vận hành"
status: in-progress
priority: P2
dependencies: [1, 2]
---

# Phase 5: Deploy Railway và vận hành

## Overview
Deploy 1 service lên Railway bằng Railpack (provider Python), Volume `/data`, env secrets, healthcheck, tài liệu vận hành. Nên deploy bản sơ bộ ngay sau phase 2 để test camera trên HTTPS thật.

## Requirements
- Functional: build tự động từ `main`; dữ liệu bền qua redeploy; job resume sau restart.
- Non-functional: 1 replica (SQLite + worker in-process); chi phí ≤ $5/tháng; secrets chỉ trong Railway Variables.

## Architecture
```
GitHub main ──► Railway (Railpack: Python detect qua requirements.txt/pyproject)
                 service booksnap
                 ├─ start: uvicorn app.main:app --host 0.0.0.0 --port $PORT
                 ├─ healthcheck: /health
                 ├─ Volume → /data  (booksnap.db, library/, tmp/)
                 └─ Variables: INVITE_CODE, GEMINI_API_KEY, GEMINI_OCR_MODEL, GEMINI_TTS_MODEL,
                               GEMINI_TTS_VOICE, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION,
                               AZURE_TTS_VOICE, TTS_DEFAULT_PROVIDER=gemini, DATA_DIR=/data
```

## Related Code Files
- Create: `app/api/export_routes.py` (`GET /api/books/{id}/export` → ZIP stream: MP3 theo seq + `text.json`), `railway.json` (startCommand, healthcheckPath, restartPolicy, numReplicas 1), `docs/deployment-guide.md`, `docs/system-architecture.md`, `docs/project-overview-pdr.md`
- Modify: `README.md`

## Implementation Steps
1. Kiểm tra với docs Railpack hiện hành: phiên bản Python được chọn (pin qua `.python-version`), cách Railpack nhận start command; xác nhận `lameenc` có wheel Linux cho version đó.
2. `railway.json`: start command, healthcheck `/health`, `numReplicas: 1`, restart ON_FAILURE.
3. Tạo Volume mount `/data`; set Variables; custom domain không bắt buộc (dùng `*.up.railway.app`, có HTTPS).
4. Smoke test prod: đăng ký 2 tài khoản (1 bằng mã mời sai → bị chặn), chụp 3 trang trên điện thoại, nghe, redeploy, kiểm tra dữ liệu còn.
5. Graceful shutdown: lifespan hủy worker, chunk đang dở quay về `pending` khi khởi động lại (đã có ở phase 2).
6. Export ZIP: stream bằng `zipfile` ghi vào response (không tạo file tạm lớn); nút "Tải bản sao" trong sheet cài đặt sách.
<!-- Updated: Validation Session 1 - backup = export ZIP thủ công -->
7. Docs: deployment-guide (biến môi trường, đổi INVITE_CODE, reset mật khẩu bằng `railway ssh` + `python -m app.cli reset-password`, đổi provider/model), system-architecture (sơ đồ luồng), runbook sự cố.

**Runbook tóm tắt:**
| Triệu chứng | Kiểm tra | Xử lý |
|---|---|---|
| Nhiều chunk `waiting_quota` lâu | Railway logs `outcome=quota`, quota trên AI Studio | Đợi reset / đổi giọng sách sang Azure |
| Nhiều chunk `failed` | Logs `outcome=error` | Bấm thử lại; kiểm tra key/model env |
| `/health` fail | Volume mount, dung lượng | Tăng Volume / xoá sách cũ |
| User quên mật khẩu | — | `python -m app.cli reset-password <username>` qua Railway shell |
| OCR sai hàng loạt | Tên model trong env | Cập nhật `GEMINI_OCR_MODEL` |

## Success Criteria
- [ ] Push `main` → deploy xanh, `/health` 200. — *chưa verify: chưa có project Railway; `railway.json` sẵn, start command bọc `/bin/sh -c`*
- [ ] Redeploy không mất sách/audio. — *chưa verify: cần deploy; `/health` trả 503 nếu DATA_DIR không nằm trên Volume*
- [x] Không secret nào trong repo (`git grep` key patterns sạch).
- [x] Export ZIP 1 sách mở được, nghe được offline.
- [ ] Chi phí dự kiến trên dashboard Railway ≤ $5/tháng sau 1 tuần. — *chưa verify: cần chạy 1 tuần*

## Risk Assessment
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| Quên gắn Volume → mất dữ liệu | M | H | `/health` fail nếu `DATA_DIR` không phải mount bền (kiểm tra file marker) |
| Volume không có backup tự động | M | M | Export ZIP thủ công từng sách (đã chấp nhận) |
| Railpack đổi hành vi detect | L | M | Pin Python version; fallback Dockerfile nếu cần |
| Lộ URL public, người lạ dùng quota | M | M | Đăng ký cần mã mời; mọi `/api` cần session; rate limit login/register |
