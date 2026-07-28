#!/usr/bin/env bash
#
# Dashy — pull the latest commit and rebuild, if there is one.
#
# Run by the dashy-update.timer installed by scripts/install.sh, or by hand:
#   sudo /opt/dashy/scripts/update.sh
#
# Safety: the new image is built BEFORE anything is swapped. If the build fails
# the running containers are left alone and the checkout is rolled back, so a
# broken commit upstream can never take the instance down.
#
# Local edits to tracked files are discarded (the checkout is reset to the
# remote branch). Keep customisation in `.env` and `docker-compose.override.yml`,
# both of which are ignored by git and preserved across updates.

set -euo pipefail

INSTALL_DIR="${DASHY_DIR:-/opt/dashy}"
BRANCH="${DASHY_BRANCH:-main}"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)    INSTALL_DIR="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    -h|--help)
      echo "Usage: update.sh [--dir <path>] [--branch <name>] [--force]"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

log() { printf '[dashy-update] %s\n' "$*"; }

cd "${INSTALL_DIR}" || { log "Install directory not found: ${INSTALL_DIR}"; exit 1; }

git fetch --quiet origin "${BRANCH}"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/${BRANCH}")"

if [ "${LOCAL}" = "${REMOTE}" ] && [ "${FORCE}" -eq 0 ]; then
  log "Already up to date (${LOCAL:0:7})."
  exit 0
fi

log "Updating ${LOCAL:0:7} → ${REMOTE:0:7}"
git reset --hard --quiet "origin/${BRANCH}"

# Build first: on failure, roll back and leave the running stack untouched.
if ! docker compose build; then
  log "Build failed — rolling back to ${LOCAL:0:7}; the running instance is unchanged."
  git reset --hard --quiet "${LOCAL}"
  exit 1
fi

log "Build succeeded — restarting services…"
docker compose up -d

# Drop images left dangling by the rebuild (keeps the disk from filling up).
docker image prune -f >/dev/null 2>&1 || true

log "Updated to ${REMOTE:0:7}."
