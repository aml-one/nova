#!/usr/bin/env bash
# LaunchDaemon target: starts MemoryBear API when down; health-probes and restarts on crash/hang.
# Run via install-macos-cores-watchdog.sh (com.nova.memorybear-watchdog).
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DYLD_LIBRARY_PATH="${DYLD_LIBRARY_PATH:-/opt/homebrew/lib}"

MB_DIR="${NOVA_MEMORYBEAR_API_DIR:-${HOME}/nova-deps/MemoryBear/api}"
MB_PORT="${NOVA_MEMORYBEAR_PORT:-8000}"
HEALTH_INTERVAL="${NOVA_MEMORYBEAR_HEALTH_INTERVAL:-60}"
RESTART_DELAY="${NOVA_MEMORYBEAR_RESTART_DELAY:-25}"
START_GRACE_SEC="${NOVA_MEMORYBEAR_START_GRACE_SEC:-120}"
UNHEALTHY_KILL_AFTER="${NOVA_MEMORYBEAR_UNHEALTHY_KILL_AFTER:-4}"
LOG_OUT="${NOVA_MEMORYBEAR_LOG_PATH:-/tmp/memorybear-api.log}"

log() {
  echo "[memorybear-watchdog $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

read_es_port() {
  local p="9201"
  if [[ -f "${MB_DIR}/.env" ]]; then
    local line
    line="$(grep -E '^ELASTICSEARCH_PORT=' "${MB_DIR}/.env" 2>/dev/null | tail -1 || true)"
    if [[ -n "${line}" ]]; then
      p="${line#ELASTICSEARCH_PORT=}"
      p="${p//[^0-9]/}"
    fi
  fi
  if [[ -z "${p}" ]]; then
    p="9201"
  fi
  echo "${p}"
}

wait_tcp() {
  local host="$1" port="$2" max_wait="$3" label="$4"
  local elapsed=0
  while [[ "${elapsed}" -lt "${max_wait}" ]]; do
    if command -v nc >/dev/null 2>&1 && nc -z "${host}" "${port}" >/dev/null 2>&1; then
      log "${label} (${host}:${port}) open"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log "WARN ${label} (${host}:${port}) not reachable within ${max_wait}s"
  return 1
}

wait_es_http() {
  local port="$1" max_wait="$2"
  local elapsed=0
  while [[ "${elapsed}" -lt "${max_wait}" ]]; do
    if curl -fsS -m 5 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
      log "Elasticsearch HTTP (:${port}) ok"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  log "WARN Elasticsearch http://127.0.0.1:${port} not healthy within ${max_wait}s"
  return 1
}

mb_healthy() {
  curl -fsS -m 12 "http://127.0.0.1:${MB_PORT}/docs" >/dev/null 2>&1
}

free_mb_port() {
  local pids pid
  pids="$(/usr/sbin/lsof -t -iTCP:"${MB_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi
  log "releasing listener(s) on :${MB_PORT}: ${pids}"
  for pid in ${pids}; do
    kill "${pid}" 2>/dev/null || true
  done
  sleep 2
}

if [[ ! -d "${MB_DIR}" ]]; then
  log "MB_DIR missing (${MB_DIR}); idle loop"
  while true; do
    sleep 300
  done
fi

ES_PORT="$(read_es_port)"

while true; do
  if mb_healthy; then
    sleep "${HEALTH_INTERVAL}"
    continue
  fi

  log "MemoryBear not healthy; preparing start"
  wait_tcp 127.0.0.1 7687 180 "Neo4j bolt" || true
  wait_tcp 127.0.0.1 5432 120 "Postgres" || true
  wait_tcp 127.0.0.1 6379 60 "Redis" || true
  wait_es_http "${ES_PORT}" 180 || true

  sleep "${RESTART_DELAY}"
  free_mb_port

  if ! cd "${MB_DIR}"; then
    log "cd ${MB_DIR} failed"
    sleep 60
    continue
  fi

  log "starting uv run -m app.main (logs: ${LOG_OUT})"
  uv run -m app.main >>"${LOG_OUT}" 2>&1 &
  mb_pid=$!

  start_ts="$(/bin/date +%s)"

  miss=0
  while kill -0 "${mb_pid}" 2>/dev/null; do
    /bin/sleep "${HEALTH_INTERVAL}"
    if mb_healthy; then
      miss=0
      continue
    fi
    now="$(/bin/date +%s)"
    if [[ $((now - start_ts)) -lt "${START_GRACE_SEC}" ]]; then
      log "still in start grace (${START_GRACE_SEC}s); ignoring failed /docs probe"
      miss=0
      continue
    fi
    miss=$((miss + 1))
    log "unhealthy probe ${miss}/${UNHEALTHY_KILL_AFTER} (pid ${mb_pid})"
    if [[ "${miss}" -ge "${UNHEALTHY_KILL_AFTER}" ]]; then
      log "killing hung MemoryBear pid ${mb_pid}"
      kill "${mb_pid}" 2>/dev/null || true
      wait "${mb_pid}" 2>/dev/null || true
      break
    fi
  done

  wait "${mb_pid}" 2>/dev/null || true
  log "MemoryBear process ended; cooldown ${RESTART_DELAY}s"
  sleep "${RESTART_DELAY}"
done
