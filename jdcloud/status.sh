#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_PORT="${OD_PORT:-17456}"
WEB_PORT="${OD_WEB_PORT:-17573}"
LOG_FILE="${APP_DIR}/.tmp/jdcloud/tools-dev-web.log"

cd "${APP_DIR}"
if command -v pnpm >/dev/null 2>&1; then
  pnpm tools-dev status --json || true
fi

echo
echo "[jdcloud] daemon health:"
curl -fsS "http://127.0.0.1:${DAEMON_PORT}/api/health" || true
echo
echo "[jdcloud] web status:"
curl -fsSI "http://127.0.0.1:${WEB_PORT}/" | head -n 1 || true
echo
echo "[jdcloud] recent log:"
tail -n 60 "${LOG_FILE}" || true
