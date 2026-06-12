#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_PORT="${OD_PORT:-17456}"
WEB_PORT="${OD_WEB_PORT:-17573}"
LOG_DIR="${APP_DIR}/.tmp/jdcloud"
PID_FILE="${LOG_DIR}/tools-dev-web.pid"
LOG_FILE="${LOG_DIR}/tools-dev-web.log"
PNPM_VERSION="10.33.2"

mkdir -p "${LOG_DIR}"

log() {
  printf '[jdcloud] %s\n' "$*"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    log "need root privileges for: $*"
    return 1
  fi
}

node_is_24() {
  command -v node >/dev/null 2>&1 && node -e 'process.exit(process.versions.node.split(".")[0] === "24" ? 0 : 1)'
}

install_node_24() {
  if node_is_24; then
    log "node $(node --version) already installed"
    return
  fi

  log "node 24 not found; trying to install Node.js 24 and native build tools"
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update
    as_root apt-get install -y ca-certificates curl python3 make g++ build-essential
    curl -fsSL https://deb.nodesource.com/setup_24.x | as_root bash -
    as_root apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y ca-certificates curl python3 make gcc-c++
    curl -fsSL https://rpm.nodesource.com/setup_24.x | as_root bash -
    as_root dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y ca-certificates curl python3 make gcc-c++
    curl -fsSL https://rpm.nodesource.com/setup_24.x | as_root bash -
    as_root yum install -y nodejs
  else
    log "unsupported package manager. Install Node.js 24 manually, then rerun this script."
    exit 1
  fi

  if ! node_is_24; then
    log "Node.js 24 install did not succeed; current node: $(command -v node >/dev/null 2>&1 && node --version || echo missing)"
    exit 1
  fi
}

install_pnpm() {
  if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version)" = "${PNPM_VERSION}" ]; then
    log "pnpm ${PNPM_VERSION} already installed"
    return
  fi

  log "installing pnpm ${PNPM_VERSION}"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable || true
    corepack prepare "pnpm@${PNPM_VERSION}" --activate || npm install -g "pnpm@${PNPM_VERSION}"
  else
    npm install -g "pnpm@${PNPM_VERSION}"
  fi
}

stop_existing() {
  if [ -f "${PID_FILE}" ]; then
    pid="$(cat "${PID_FILE}" || true)"
    if [ -n "${pid:-}" ] && kill -0 "${pid}" >/dev/null 2>&1; then
      log "stopping previous tools-dev process ${pid}"
      kill "${pid}" || true
      for _ in $(seq 1 20); do
        kill -0 "${pid}" >/dev/null 2>&1 || break
        sleep 0.5
      done
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
    rm -f "${PID_FILE}"
  fi
}

wait_for_http() {
  name="$1"
  url="$2"
  for _ in $(seq 1 90); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      log "${name} is ready at ${url}"
      return
    fi
    sleep 1
  done
  log "${name} did not become ready; last log lines:"
  tail -n 80 "${LOG_FILE}" || true
  exit 1
}

cd "${APP_DIR}"

if [ "${NO_INSTALL:-0}" != "1" ]; then
  install_node_24
  install_pnpm
  log "installing project dependencies"
  pnpm install --frozen-lockfile
else
  log "NO_INSTALL=1; skipping Node/pnpm/dependency install"
fi

stop_existing

log "starting Open Design daemon/web on 127.0.0.1:${DAEMON_PORT} and 127.0.0.1:${WEB_PORT}"
nohup env OD_PORT="${DAEMON_PORT}" OD_WEB_PORT="${WEB_PORT}" pnpm tools-dev run web --daemon-port "${DAEMON_PORT}" --web-port "${WEB_PORT}" > "${LOG_FILE}" 2>&1 &
echo "$!" > "${PID_FILE}"

wait_for_http "daemon" "http://127.0.0.1:${DAEMON_PORT}/api/health"
wait_for_http "web" "http://127.0.0.1:${WEB_PORT}/"

log "started successfully"
log "log file: ${LOG_FILE}"
log "pid file: ${PID_FILE}"
log "local tunnel command from your computer:"
log "ssh -i <your-ssh-key> -L 17573:127.0.0.1:${WEB_PORT} -L 17456:127.0.0.1:${DAEMON_PORT} root@117.72.120.209"
log "then open: http://127.0.0.1:17573"
