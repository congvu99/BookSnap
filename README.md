# BookSnap

Chụp trang sách bằng camera trình duyệt → Gemini OCR → TTS tiếng Việt → vừa đọc vừa nghe. App cá nhân/gia đình: nhiều tài khoản dùng chung 1 thư viện, mỗi người có tiến độ nghe riêng.

- Backend: Python 3.12, FastAPI, SQLite (aiosqlite, WAL), worker asyncio chạy trong cùng process.
- Frontend: PWA không build step (Preact + htm vendored) dưới `web/`, FastAPI serve static.
- Deploy: Railway (Railpack), 1 replica, Volume `/data`.

Plan & quyết định kiến trúc: [plans/260929-1003-booksnap-mvp/plan.md](plans/260929-1003-booksnap-mvp/plan.md). Thiết kế UI: [docs/design-guidelines.md](docs/design-guidelines.md).

## Chạy local

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
cp .env.example .env    # điền INVITE_CODE, GEMINI_API_KEY (và AZURE_* nếu dùng)
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Mở http://localhost:8000 → Đăng ký bằng mã mời trong `INVITE_CODE`. Safari trên `http://localhost` không nhận cookie `Secure` → đặt `COOKIE_SECURE=false` khi dev. Camera cần HTTPS khi truy cập từ điện thoại (dùng bản deploy Railway hoặc tunnel HTTPS).

Test: `.venv/Scripts/python -m pytest -q` (không gọi mạng; provider OCR/TTS được giả lập).

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `DATA_DIR` | `./data` | DB `booksnap.db`, audio `library/`, ảnh tạm `tmp/`. Prod: `/data` (Volume) |
| `INVITE_CODE` | trống | Bắt buộc để đăng ký; trống = đóng đăng ký |
| `COOKIE_SECURE` | `true` | |
| `GEMINI_API_KEY` | | OCR + TTS Gemini |
| `GEMINI_OCR_MODEL` / `GEMINI_TTS_MODEL` | `gemini-2.5-flash` / `gemini-2.5-flash-preview-tts` | Đổi khi model preview đổi tên |
| `GEMINI_TTS_VOICE`, `GEMINI_TTS_STYLE` | `Kore`, giọng kể chuyện | Giọng mặc định cho sách mới |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_TTS_VOICE` | `southeastasia`, `vi-VN-HoaiMyNeural` | Tuỳ chọn |
| `TTS_DEFAULT_PROVIDER` | `gemini` | Provider gán cho sách mới (không tự fallback) |
| `OCR_CONCURRENCY`, `TTS_CONCURRENCY` | `2`, `2` | |
| `GEMINI_OCR_RPM`, `GEMINI_TTS_RPM`, `AZURE_TTS_RPM` | `15`, `10`, `20` | Rate limit mềm phía client |

Danh sách đầy đủ: [app/config.py](app/config.py).

## Cấu trúc

```
app/
  main.py            create_app(), lifespan (DB, worker), /health, static web/
  config.py db.py    settings; SQLite + migration theo PRAGMA user_version
  auth/              đăng ký (mã mời), đăng nhập, session cookie, rate limit
  api/               books, pages, chunks/audio, progress, voices, export ZIP
  repositories/      SQL thuần, trả dataclass
  pipeline/          worker OCR → chunker → TTS, retry/quota, dọn ảnh tạm
  cli.py             python -m app.cli reset-password <username>
web/                 PWA: camera, thư viện, reader + player, service worker
scripts/voice_poc.py PoC chọn giọng (cần API key thật)
tests/
```

## Vận hành

- Đặt lại mật khẩu: `python -m app.cli reset-password <username>` (qua `railway ssh`), đồng thời đăng xuất mọi thiết bị của user.
- Backup: nút "Tải bản sao" trong cài đặt sách → ZIP (MP3 + `text.json`), endpoint `GET /api/books/{id}/export`.
- `/health` trả 503 nếu DB lỗi, `DATA_DIR` không ghi được, hoặc chạy trên Railway mà `DATA_DIR` không nằm trên Volume.
