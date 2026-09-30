# BookSnap

Chụp trang sách bằng camera trình duyệt → Gemini OCR → TTS tiếng Việt → vừa đọc vừa nghe. App cá nhân/gia đình: nhiều tài khoản dùng chung 1 thư viện, mỗi người có tiến độ nghe riêng.

- Backend: Python 3.12, FastAPI, SQLite (aiosqlite, WAL), worker asyncio chạy trong cùng process.
- Frontend: PWA không build step (Preact + htm vendored) dưới `web/`, FastAPI serve static.
- Deploy: Railway (Railpack), 1 replica, Volume `/data`; hoặc VPS (Docker Compose + Caddy HTTPS) theo [docs/deployment-vps-guide.html](docs/deployment-vps-guide.html) (`compose.yml`, `deploy/deploy.sh`, `deploy/backup.sh`).

Plan & quyết định kiến trúc: [plans/260929-1003-booksnap-mvp/plan.md](plans/260929-1003-booksnap-mvp/plan.md). Thiết kế UI: [docs/design-guidelines.md](docs/design-guidelines.md).

## Chạy local

### Cài lần đầu

```powershell
cd D:\project\BookSnap
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
copy .env.example .env     # rồi mở .env điền INVITE_CODE, GEMINI_API_KEY (và AZURE_* nếu dùng)
```

Linux/macOS: `python3.12 -m venv .venv`, `.venv/bin/python …`, `cp .env.example .env`.

### Chạy lại (mỗi lần muốn dùng)

```powershell
cd D:\project\BookSnap
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

- Mở http://localhost:8000 → lần đầu bấm **Đăng ký** và nhập mã mời = giá trị `INVITE_CODE` trong `.env`; các lần sau chỉ cần **Đăng nhập**.
- Dừng server: `Ctrl+C` trong cửa sổ đang chạy.
- App tự đọc `.env`, tự nâng cấp DB (migration) khi khởi động. Dữ liệu (DB, audio) nằm trong `data/` — giữ nguyên giữa các lần chạy; xoá thư mục này = bắt đầu lại từ đầu.
- Sau khi `git pull` có đổi `requirements*.txt`: chạy lại `.venv\Scripts\python -m pip install -r requirements-dev.txt`.
- Kiểm nhanh server sống: http://localhost:8000/health → `{"status":"ok",…}`.

### Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Sửa code/CSS mà giao diện không đổi | Service worker giữ bản cũ (cache-first). Chrome: DevTools → Application → Storage → **Clear site data**, rồi tải lại. Khi phát hành: tăng `SHELL_CACHE` trong `web/sw.js` |
| Đăng nhập trên Safari xong vẫn bị đá ra | Đặt `COOKIE_SECURE=false` trong `.env` (Safari không nhận cookie `Secure` trên `http://localhost`) |
| `address already in use` / cổng 8000 bận | Đổi cổng `--port 8001`, hoặc tìm và tắt tiến trình cũ: `netstat -ano \| findstr :8000` → `taskkill /PID <pid> /F` |
| Chưa có API key, chỉ muốn xem giao diện | Thêm `WORKER_ENABLED=false` vào `.env` (tắt pipeline OCR/TTS; thư viện, đăng nhập, player vẫn chạy) |
| Không đăng ký được | `INVITE_CODE` trong `.env` đang trống, hoặc gõ sai mã |

### Mở trên iPhone

- Cùng Wi-Fi: chạy thêm `--host 0.0.0.0` (`… uvicorn app.main:app --host 0.0.0.0 --port 8000`), mở `http://<IP máy tính>:8000` trên iPhone, và đặt `COOKIE_SECURE=false`. Xem IP bằng `ipconfig` (dòng IPv4). Cách này **không dùng được camera** (Safari chỉ cho camera trên HTTPS).
- Muốn chụp trang: dùng bản deploy Railway, hoặc tunnel HTTPS (vd. `cloudflared tunnel --url http://localhost:8000`) rồi mở link `https://…` được in ra.

### Test & mockup

- Test: `.venv\Scripts\python -m pytest -q` (không gọi mạng; provider OCR/TTS được giả lập).
- Test JS thuần (helper không import Preact): `node --test "tests/web/**/*.test.mjs"` (Node ≥22.7, không cần package.json).
- Nhạc nền (`web/audio/ambient/`): nguồn, giấy phép và cách thêm bài nằm trong [CREDITS.md](web/audio/ambient/CREDITS.md). Chuẩn hoá bằng `scripts/prepare_ambient_audio.py` (cần ffmpeg hoặc `pip install imageio-ffmpeg`).
- Mockup giao diện (không cần server): mở trực tiếp [docs/mockups/vinyl-library-preview.html](docs/mockups/vinyl-library-preview.html) trong trình duyệt; thêm `?screen=listen&playing=1` hoặc `?screen=auth` để vào thẳng một màn.

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `DATA_DIR` | `./data` | DB `booksnap.db`, audio `library/`, ảnh tạm `tmp/`. Prod: `/data` (Volume) |
| `INVITE_CODE` | trống | Bắt buộc để đăng ký; trống = đóng đăng ký |
| `COOKIE_SECURE` | `true` | |
| `GEMINI_API_KEY` | | OCR + TTS Gemini |
| `GEMINI_OCR_MODEL` / `GEMINI_TTS_MODEL` | `gemini-2.5-flash` / `gemini-2.5-flash-preview-tts` | Đổi khi model preview đổi tên |
| `GEMINI_TTS_VOICE`, `GEMINI_TTS_STYLE` | `Charon` (nam, trầm), giọng kể chuyện | Giọng mặc định cho sách mới; sách cũ giữ giọng đã gán. Đổi giọng (chỉ cho đoạn chưa có audio) ở bước chụp thêm trang |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_TTS_VOICE` | `southeastasia`, `vi-VN-HoaiMyNeural` | Tuỳ chọn |
| `TTS_DEFAULT_PROVIDER` | `gemini` | Provider gán cho sách mới (không tự fallback) |
| `OCR_CONCURRENCY`, `TTS_CONCURRENCY` | `2`, `2` | |
| `GEMINI_OCR_RPM`, `GEMINI_TTS_RPM`, `AZURE_TTS_RPM` | `15`, `10`, `20` | Rate limit mềm phía client |
| `GEMINI_OCR_RPD`, `GEMINI_TTS_RPD` | `0` | Hạn mức request/ngày (reset nửa đêm giờ Pacific) để trang Tài khoản tính "còn lại". Lấy số từ AI Studio → Rate limits. `0` = chỉ hiện đã dùng |
| `AZURE_TTS_MONTHLY_CHARS` | `0` | Hạn mức ký tự/tháng Azure (F0: 500000) |
| `USAGE_RETENTION_DAYS` | `62` | Giữ log lượt gọi provider bao lâu |

Danh sách đầy đủ: [app/config.py](app/config.py).

## Cấu trúc

```
app/
  main.py            create_app(), lifespan (DB, worker), /health, static web/
  config.py db.py    settings; SQLite + migration theo PRAGMA user_version
  auth/              đăng ký (mã mời), đăng nhập, session cookie, rate limit
  api/               books, pages, chunks/audio, progress, voices, export ZIP, account, usage
  usage_quota.py     cửa sổ reset + tổng hợp hạn mức provider (đo cục bộ, xem /api/usage)
  repositories/      SQL thuần, trả dataclass
  pipeline/          worker OCR → chunker → TTS, retry/quota, dọn ảnh tạm
  cli.py             python -m app.cli reset-password <username>
web/                 PWA: camera, thư viện, reader + player, service worker
scripts/voice_poc.py Nghe thử giọng: `--text "..." --voices Charon,Orus --style "..."` (cần API key thật)
tests/
```

## Vận hành

- Đặt lại mật khẩu: `python -m app.cli reset-password <username>` (qua `railway ssh`), đồng thời đăng xuất mọi thiết bị của user.
- Backup: nút "Tải bản sao" trong cài đặt sách → ZIP (MP3 + `text.json`), endpoint `GET /api/books/{id}/export`.
- `/health` trả 503 nếu DB lỗi, `DATA_DIR` không ghi được, hoặc chạy trên Railway mà `DATA_DIR` không nằm trên Volume.
