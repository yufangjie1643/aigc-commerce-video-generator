#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${APP_DIR}/.tmp/jdcloud"
PID_FILE="${LOG_DIR}/tools-dev-web.pid"

cd "${APP_DIR}"
if command -v pnpm >/dev/null 2>&1; then
  pnpm tools-dev stop --namespace default || true
fi

if [ -f "${PID_FILE}" ]; then
  pid="$(cat "${PID_FILE}" || true)"
  if [ -n "${pid:-}" ] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" || true
    sleep 2
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${PID_FILE}"
fi

echo "[jdcloud] stopped"
