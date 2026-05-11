#!/usr/bin/env bash
# LaunchDaemon target: keeps Orpheus inference (:5006) + FastAPI (:5005) healthy.
# Run via install-macos-cores-watchdog.sh (com.nova.orpheus-watchdog).
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

INF_PORT="${LLAMA_SERVER_PORT:-5006}"
API_PORT="${ORPHEUS_PORT:-5005}"
HEALTH_INTERVAL="${NOVA_ORPHEUS_HEALTH_INTERVAL:-45}"
RESTART_DELAY="${NOVA_ORPHEUS_RESTART_DELAY:-25}"
STARTER="${ROOT_DIR}/scripts/mac-start-orpheus-native.sh"

log() {
  echo "[orpheus-watchdog $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

infer_ok() {
  curl -fsS -m 8 "http://127.0.0.1:${INF_PORT}/health" >/dev/null 2>&1 ||
    curl -fsS -m 8 "http://127.0.0.1:${INF_PORT}/v1/models" >/dev/null 2>&1
}

api_ok() {
  curl -fsS -m 10 "http://127.0.0.1:${API_PORT}/docs" >/dev/null 2>&1
}

ensure_up() {
  if [[ ! -x "${STARTER}" ]]; then
    log "missing starter: ${STARTER}"
    return 1
  fi
  log "running ${STARTER}"
  bash "${STARTER}" || log "starter exited non-zero (continuing)"
}

if [[ ! -f "${STARTER}" ]]; then
  log "Orpheus starter not found; sleeping 120s"
  sleep 120
fi

ensure_up || true

while true; do
  sleep "${HEALTH_INTERVAL}"
  if infer_ok && api_ok; then
    continue
  fi
  log "unhealthy (inference or API probe failed); restarting after ${RESTART_DELAY}s"
  sleep "${RESTART_DELAY}"
  ensure_up || true
done
