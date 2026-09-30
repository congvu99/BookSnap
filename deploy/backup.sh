#!/usr/bin/env bash
# Consistent snapshot of the live SQLite DB (online backup API, safe under WAL) plus the audio
# library, written as one dated tarball. Old tarballs beyond KEEP_DAYS are deleted.
set -Eeuo pipefail

cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-/srv/backups/booksnap}"
KEEP_DAYS="${KEEP_DAYS:-7}"
SNAPSHOT=/data/.backup-snapshot.db

mkdir -p "$DEST"
out="$DEST/booksnap-$(date +%Y%m%d-%H%M%S).tar.gz"

cleanup() {
  rm -f "$out.partial"
  docker compose exec -T app rm -f "$SNAPSHOT" || true
}
trap cleanup EXIT

if [[ -z "$(docker compose ps -q --status running app)" ]]; then
  echo "$(date '+%F %T') backup skipped: app container not running" >&2
  exit 1
fi

docker compose exec -T app python -c "
import sqlite3
src = sqlite3.connect('/data/booksnap.db')
dst = sqlite3.connect('$SNAPSHOT')
src.backup(dst)
dst.close()
src.close()
"
docker compose exec -T app tar -C /data -czf - .backup-snapshot.db library > "$out.partial"
mv "$out.partial" "$out"

find "$DEST" -name 'booksnap-*.tar.gz' -mtime "+$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup ok: $out ($(du -h "$out" | cut -f1))"
