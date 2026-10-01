# Deployment Guide — Railway (Railpack)

**Last updated:** 2026-09-30

> Self-hosted VPS alternative (Docker Compose + shared Caddy, auto HTTPS, backups, multi-project template): [deployment-vps-guide.html](deployment-vps-guide.html). Files: `Dockerfile`, `compose.yml`, `deploy/deploy.sh`, `deploy/backup.sh`.

## Quick Start — First Deploy

1. **Prepare Railway project**
   - Create a new Railway project
   - Authorize GitHub (push-to-deploy enabled)
   - Create a volume: `/data` (50 GB sufficient for 1000+ books)

2. **Set environment variables** (Railway dashboard → Variables)
   ```
   INVITE_CODE=<your-secret-code>
   GEMINI_API_KEY=<AI Studio key>
   GEMINI_OCR_MODEL=gemini-2.5-flash
   GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
   GEMINI_TTS_VOICE=Kore
   TTS_DEFAULT_PROVIDER=gemini
   COOKIE_SECURE=true
   DATA_DIR=/data
   ```
   (Optional: Azure keys if using Azure voice)

3. **Deploy**
   - Push to `main` branch
   - Railway auto-detects Python (`.python-version` = 3.12)
   - Builds requirements.txt → installs dependencies
   - Runs `startCommand` from `railway.json`
   - Healthcheck polls `/health` every 10 seconds

4. **Verify**
   ```bash
   # Check logs: Railway dashboard or CLI
   railway logs -f
   
   # Test health
   curl https://<your-service>.up.railway.app/health
   # Expected: {"status":"ok","db":"ok","data_dir":"ok"}
   
   # Test register (use INVITE_CODE from env)
   curl -X POST https://…/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "username": "test",
       "display_name": "Test User",
       "password": "SecurePass123!",
       "invite_code": "<INVITE_CODE>"
     }'
   ```

## Configuration — Complete Reference

**Source:** `app/config.py` (Pydantic BaseSettings, reads `.env`)

| Env Var | Type | Default | Notes |
|---------|------|---------|-------|
| `DATA_DIR` | Path | `./data` | SQLite + library + temp; prod = `/data` (volume) |
| `INVITE_CODE` | str | (empty) | Required to register; empty = registration closed |
| `COOKIE_SECURE` | bool | `true` | `false` for local dev (Safari + localhost needs it) |
| `SESSION_TTL_DAYS` | int | 180 | Cookie Max-Age |
| `MAX_UPLOAD_BYTES` | int | 5242880 (5 MB) | Max image size per upload |
| `AUTH_RATE_LIMIT_PER_MINUTE` | int | 10 | Login/register attempts per IP |
| `LOG_LEVEL` | str | `INFO` | DEBUG, INFO, WARNING, ERROR |
| | | | |
| `GEMINI_API_KEY` | str | (empty) | Required if TTS_DEFAULT_PROVIDER=gemini |
| `GEMINI_OCR_MODEL` | str | `gemini-2.5-flash` | Change when preview model renamed |
| `GEMINI_OCR_RPM` | int | 15 | Soft rate limit (actual quota measured via PoC) |
| `GEMINI_TTS_MODEL` | str | `gemini-2.5-flash-preview-tts` | Change when model GA'd |
| `GEMINI_TTS_VOICE` | str | `Kore` | Default voice for new books |
| `GEMINI_TTS_STYLE` | str | `Đọc bằng giọng kể chuyện…` | Voice style prompt |
| `GEMINI_TTS_RPM` | int | 10 | Soft rate limit |
| | | | |
| `AZURE_SPEECH_KEY` | str | (empty) | Leave empty to disable Azure |
| `AZURE_SPEECH_REGION` | str | `southeastasia` | Region for REST API |
| `AZURE_TTS_VOICE` | str | `vi-VN-HoaiMyNeural` | Default Azure voice |
| `AZURE_TTS_RPM` | int | 20 | Soft rate limit |
| | | | |
| `TTS_DEFAULT_PROVIDER` | str | `gemini` | Provider for new books (gemini \| azure) |
| `OCR_CONCURRENCY` | int | 2 | Parallel OCR workers (don't exceed Gemini RPM) |
| `TTS_CONCURRENCY` | int | 2 | Parallel TTS workers |
| `WORKER_POLL_SECONDS` | float | 2.0 | Idle loop sleep before next poll |
| `FAILED_IMAGE_TTL_HOURS` | int | 24 | TTL for orphan images in tmp/ |
| `TAIL_SEAL_GRACE_SECONDS` | float | 90.0 | Idle time before synthesizing unsealed tail chunk |
| `CLEANUP_INTERVAL_SECONDS` | float | 3600.0 | Interval between TTL/orphan sweeps |

**To change a setting on a live deploy:**
1. Railway dashboard → Variables → edit → save
2. Service auto-restarts
3. Logs confirm: `startup` line with new config

## Health Check

**Endpoint:** `GET /health` (no auth required)

**Response (200 OK):**
```json
{
  "status": "ok",
  "db": "ok",
  "data_dir": "ok"
}
```

**Response (503 Error):**
```json
{
  "status": "error",
  "db": "error: OperationalError",
  "data_dir": "ok"
}
```

**Semantics:**
- `db` fail: SQLite connection error or query failure
- `data_dir` fail: write test failed, or running on Railway with no volume mount
- Returns 503 if ANY component fails (startuptrigger auto-restart)

**Railway integration:**
- Healthcheck path: `/health`
- Healthcheck interval: 10 seconds
- Restart policy: ON_FAILURE (retries up to 5 times)

## Volume & Persistence

**What lives on the volume:**
```
/data/
├── booksnap.db              (SQLite database, ~1 MB → grows with chunks)
├── booksnap.db-wal          (Write-ahead log)
├── booksnap.db-shm          (Shared memory)
├── library/
│   └── {book_id}/
│       ├── 00000-abcd1234.mp3   (chunk seq 0, content-hash prefix)
│       ├── 00001-efgh5678.mp3
│       └── …
└── tmp/
    ├── {page_id}.jpg        (temporary, deleted after OCR OR TTL 24h)
    └── …
```

**Persistence guarantees:**
- Volume mounted at `/health` startup verification
- SQLite WAL mode (durable to disk per transaction)
- No in-process/in-memory storage of user data
- Redeploy/restart: volume persists across restart
- Migration: copy `/data` to new volume; DB auto-migrates on first connect

**Failure modes:**
- **No volume:** `/health` returns 503 (`data_dir_not_durable`); redeploy message warns ("forgot to mount volume")
- **Volume full:** Audio write fails, chunk marks `failed`; TTL sweep helps; user must delete old books
- **Disk error:** SQLite transaction fails; chunk marks failed; logs error

## Operations Runbook

### Daily Operations

| Symptom | Check | Action |
|---------|-------|--------|
| Many chunks `waiting_quota` | Railway logs: `outcome=quota` | 1. Check [Gemini quota](https://ai.google.dev) 2. Wait for reset (auto-requeue at `not_before`) 3. Or use PUT `/api/books/{id}/voice` to change provider (e.g. to Azure; unparks waiting chunks) |
| Many chunks `failed` | Logs: `outcome=error` | Retry from book status view. If pattern: check `GEMINI_OCR_MODEL` / `GEMINI_TTS_MODEL` env |
| `/health` → 503 | Dashboard volume list | Verify volume mounted. Check free space (`du -sh /data`). If full: delete old books or export+delete. |
| User: "forgot password" | — | SSH to Railway, run reset command (see below) |
| Web: old JS cached | Users have stale app | PWA cache: wait for SW update (user refresh app). Server-side: no action needed. |

### User Account Recovery

**SSH into container:**
```bash
railway run bash
```

**Reset family account password:**
```bash
python -m app.cli reset-password <family-account-username>
# Prompts for the new password twice (6-128 chars)
# Revokes every session of the account (all devices, all profiles)
# Everyone then signs in with the family username + new password
```

**Check current status:**
```bash
sqlite3 /data/booksnap.db "SELECT username, COUNT(*) as books FROM users u LEFT JOIN books b ON u.id=b.created_by GROUP BY u.id;"
```

### Debugging

**Tail logs (from local machine):**
```bash
railway logs -f
# Or via CLI
railway --help
```

**Inspect database (read-only):**
```bash
railway run sqlite3 /data/booksnap.db
> SELECT * FROM books ORDER BY updated_at DESC LIMIT 5;
> SELECT COUNT(*) as chunks, status FROM chunks GROUP BY status;
> .quit
```

**Force worker retry (if stuck):**
```bash
railway run python -c "
import asyncio
from app.config import get_settings
from app.db import Database
from app.repositories.page_repository import PageRepository
settings = get_settings()
db = Database(settings.db_path)
asyncio.run(db.connect())
asyncio.run(db.execute('UPDATE pages SET status=\"uploaded\" WHERE status=\"ocr_processing\"'))
asyncio.run(db.close())
print('Resumed OCR rows')
"
# Then: push dummy commit to trigger redeploy (forces worker.resume())
```

## Changing Configuration

### Change INVITE_CODE (Registration Open/Close)

1. Railway dashboard → Variables → `INVITE_CODE`
2. Set to new code or empty string to disable registration
3. Save → service restarts
4. Existing sessions unaffected

### Change OCR/TTS Model

1. Get new model name (e.g., `gemini-2.5-flash-001` when preview ends)
2. Update `GEMINI_OCR_MODEL` or `GEMINI_TTS_MODEL` env
3. Save → service restarts
4. **Future jobs** use new model
5. **In-flight jobs:** unaffected (model captured at claim time)
6. **Stuck chunks:** if OCR model breaks, chunks stuck in `ocr_processing` — reset them (see above) or re-upload pages

### Change TTS Provider (e.g., Gemini → Azure)

**For new books:**
1. Update `TTS_DEFAULT_PROVIDER` env to `azure`
2. Ensure `AZURE_SPEECH_KEY` is set

**For existing books with quota:**
1. User opens the Capture flow for the book (add pages)
2. User chooses an Azure voice at the voice confirmation step (calls PUT `/api/books/{id}/voice`)
3. All `waiting_quota` chunks→`pending` immediately (provider changed, not_before cleared)
4. TTS resumes with Azure credentials; `done` chunks keep their original audio

### Bump Web Cache Version (JS/CSS Changes)

If web files change, update `SHELL_CACHE` in `web/sw.js`:
```javascript
const SHELL_CACHE = 'booksnap-shell-v3';  // ← increment version
```

Then commit + push → auto-deploy. Installed PWAs pick up new code when they next refresh.

## Smoke Test Checklist (Post-Deploy)

After first deploy or major changes, manually verify:

- [ ] `/health` returns 200 with all OK
- [ ] Register 2 accounts (one with wrong invite code → 403; one correct → 201)
- [ ] Login/logout works
- [ ] Can create a book, capture 3 pages on phone (Android Chrome or iOS Safari)
- [ ] Book status view shows "Tải ảnh: 3 trang đã gửi"
- [ ] Wait 2–3 min for OCR; check for OCR failures (if no Gemini key: expected)
- [ ] Reader loads (empty chunks OK if no TTS)
- [ ] Export ZIP button works, download plays offline
- [ ] Redeploy (push dummy commit) → data survives
- [ ] After redeploy: original 2 accounts + book still there

## Backup & Recovery

**Backup (manual):**
1. Use book status "Tải bản sao" button → ZIP download (per book)
2. Or: Railway volume snapshot (if available in plan)
3. Or: `railway run tar -czf - /data | gzip > backup.tar.gz` → download

**Recovery (if volume lost):**
1. Restore `/data` from backup OR clear and start fresh
2. On first start: `booksnap.db` missing → migrations run from scratch
3. If partial data: use exported ZIPs to re-import (no import endpoint in MVP; manual re-upload)

## Cost Estimate

| Component | Hourly | Monthly |
|-----------|--------|---------|
| 1 Replica (included) | $0.10 | $73 |
| Volume 50 GB | $0.15/GB | ~$7–10 |
| Bandwidth (egress) | varies | ~$1–5 (MP3 downloads + API) |
| **Total estimate** | | **$5–15/month** |

**Usage assumption:** 100 pages/month, ~5h audio (~140 MB library growth). Scale sub-linearly with number of users (shared library).

## Troubleshooting

**Q: Redeploy failed**
- A: Check Railway logs. Common: missing Gemini key (optional for non-TTS), typo in INVITE_CODE. If DB error: likely schema issue — ensure migrations are append-only, never edit existing.

**Q: "Offline và chưa tải sẵn" (offline + not downloaded)**
- A: User's phone lost network. If chunk not downloaded, it can't play offline. Expected. User should use "Tải để nghe offline" button on chunks before losing connectivity.

**Q: Chunks stuck in `waiting_quota` forever**
- A: Quota reset time passed, but not auto-requeued? Worker loop crashed (H1 residual, no timeout on Gemini calls). Restart service (push to main).

**Q: "Không tìm thấy trang" after upload**
- A: Rare: concurrent book delete mid-upload. Safe race: foreign key error becomes 409. Retry upload.

**Q: `/health` 503 after deploy**
- A: Missing volume mount. Railway dashboard → service → storage → add `/data` mount. Redeploy.

---

**Next steps:**
- Run `scripts/voice_poc.py` with real Gemini/Azure keys to measure actual quota
- Manual device testing (Android camera, iOS Safari, offline playback)
- Monitor logs for the first week post-MVP deploy
