#!/usr/bin/env bash
# Fast-forward to origin/main, build an image tagged with the commit, back up, swap the single
# container, and roll back to the previous image if /health does not turn healthy in time.
set -Eeuo pipefail

cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-main}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
TAG_FILE=.deployed-tag

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

container_status() {
  local id
  id="$(docker compose ps -q app)"
  [[ -n "$id" ]] || { echo missing; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) status
  while (( SECONDS < deadline )); do
    status="$(container_status)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy|exited|dead) return 1 ;;
    esac
    sleep 3
  done
  return 1
}

prev_tag="$(cat "$TAG_FILE" 2>/dev/null || true)"

git fetch --quiet origin "$BRANCH"
git merge --ff-only --quiet "origin/$BRANCH"
new_tag="$(git rev-parse --short=12 HEAD)"

if [[ "$new_tag" == "$prev_tag" && "${FORCE:-0}" != 1 ]]; then
  log "already at $new_tag, nothing to deploy (FORCE=1 to rebuild)"
  exit 0
fi

log "building booksnap:$new_tag"
IMAGE_TAG="$new_tag" docker compose build --pull

if [[ -n "$(docker compose ps -q --status running app)" ]]; then
  log "pre-deploy backup"
  bash deploy/backup.sh
fi

log "starting booksnap:$new_tag (was ${prev_tag:-none})"
IMAGE_TAG="$new_tag" docker compose up -d --remove-orphans

if wait_healthy; then
  echo "$new_tag" > "$TAG_FILE"
  docker tag "booksnap:$new_tag" booksnap:latest
  docker images booksnap --format '{{.Tag}}' \
    | grep -vxE "latest|$new_tag|${prev_tag:-__none__}" \
    | xargs -r -I{} docker rmi "booksnap:{}" >/dev/null || true
  log "deploy ok: $new_tag"
  exit 0
fi

log "deploy FAILED: $new_tag not healthy after ${HEALTH_TIMEOUT}s"
docker compose logs --tail 60 app || true

if [[ -n "$prev_tag" ]]; then
  log "rolling back to $prev_tag"
  IMAGE_TAG="$prev_tag" docker compose up -d --remove-orphans
  git reset --hard --quiet "$prev_tag"
  wait_healthy && log "rollback ok: $prev_tag" || log "rollback ALSO unhealthy, check logs"
fi
exit 1
