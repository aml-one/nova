#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESTART_DELAY_SECONDS=2
WEB_HOST="${NOVA_WEB_HOST:-0.0.0.0}"
AGENT_PORT="${NOVA_AGENT_PORT:-8787}"
ENABLE_HTTPS="${NOVA_WEB_HTTPS:-false}"
HTTPS_CERT_PATH="${NOVA_WEB_HTTPS_CERT:-${ROOT_DIR}/tmp/dev-cert.pem}"
HTTPS_KEY_PATH="${NOVA_WEB_HTTPS_KEY:-${ROOT_DIR}/tmp/dev-key.pem}"

# launchd has a minimal PATH; include common Homebrew/bin locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

# Load repo-local environment for agent-core + web when running under launchd.
# launchd does not read shell profiles, so secrets like NOVA_SETTINGS_SECRET would otherwise be missing.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

run_pnpm() {
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return $?
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return $?
  fi
  if command -v npm >/dev/null 2>&1; then
    npx --yes pnpm "$@"
    return $?
  fi
  return 127
}

# macOS ships Bash 3.2 — avoid Bash 4+ features like ${var,,}
https_enabled() {
  case "${ENABLE_HTTPS}" in
    [Tt][Rr][Uu][Ee] | 1 | [Yy][Ee][Ss]) return 0 ;;
    *) return 1 ;;
  esac
}

# NOVA_WEB_PORT overrides everything. Else NOVA_WEB_STANDARD_PORTS=1 uses 80 (HTTP) or 443 (HTTPS) for default browser ports.
if [[ -n "${NOVA_WEB_PORT:-}" ]]; then
  WEB_PORT="${NOVA_WEB_PORT}"
elif [[ "${NOVA_WEB_STANDARD_PORTS:-}" == "1" ]]; then
  if https_enabled; then
    WEB_PORT="443"
  else
    WEB_PORT="80"
  fi
else
  WEB_PORT="3000"
fi

if [[ "${WEB_PORT}" =~ ^[0-9]+$ ]] && [[ "${WEB_PORT}" -lt 1024 ]]; then
  echo "Note: web port ${WEB_PORT} is privileged on macOS/Linux; if bind fails, run with sudo or set NOVA_WEB_PORT=3000."
fi

AGENT_PID=""
WEB_PID=""

# Kill a PID and its descendants (pnpm → tsx/node often leaves children holding ports).
kill_tree() {
  local pid="$1"
  [[ -z "${pid}" ]] && return 0
  local child
  for child in $(pgrep -P "${pid}" 2>/dev/null || true); do
    kill_tree "${child}"
  done
  kill "${pid}" 2>/dev/null || true
}

cleanup() {
  kill_tree "${AGENT_PID}"
  kill_tree "${WEB_PID}"
}

# Optional: before starting, free default dev ports (macOS/Linux). Set NOVA_LOCAL_FREE_PORTS=1.
free_tcp_port_if_requested() {
  case "${NOVA_LOCAL_FREE_PORTS:-}" in
    [Tt][Rr][Uu][Ee] | 1 | [Yy][Ee][Ss]) ;;
    *) return 0 ;;
  esac
  if ! command -v lsof >/dev/null 2>&1; then
    echo "NOVA_LOCAL_FREE_PORTS is set but lsof was not found; skipping port cleanup."
    return 0
  fi
  local port pids
  for port in 8787 "${WEB_PORT}"; do
    pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      echo "NOVA_LOCAL_FREE_PORTS: freeing TCP ${port} (PIDs: ${pids})"
      kill ${pids} 2>/dev/null || true
    fi
  done
  sleep 1
}

agent_http_healthy() {
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  # 5s timeout (was 2s): agent-core occasionally takes a beat to respond when it's also serving
  # the channel-debug poller, the learning daemon, and Next.js dev compilations in parallel.
  curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" >/dev/null 2>&1
}

# When /health is slow, it almost always means the Node event loop is busy serving a long chat
# request (cold-loading an 18 GB Ollama model can stall fetch-keepalive responses for ~10–30 s).
# Killing agent-core mid-chat aborts the model call, leaves typing indicators stuck, and never
# delivers a reply. Before counting the fail, check the longer-timeout heartbeat for `busy=true`.
agent_busy_with_chat() {
  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi
  local body
  body="$(curl -fsS --max-time 12 "http://127.0.0.1:${AGENT_PORT}/v1/system/heartbeat" 2>/dev/null || true)"
  if [[ -z "${body}" ]]; then
    return 1
  fi
  case "${body}" in
    *'"busy":true'*|*'"inFlight":1'*|*'"inFlight":2'*|*'"inFlight":3'*) return 0 ;;
    *) return 1 ;;
  esac
}

# Rollback marker is written by the in-app update flow before `git pull`.
# After an update we monitor health more aggressively; if it never comes back,
# we reset to the previous commit so a bad release can never permanently break Nova.
ROLLBACK_MARKER="${ROOT_DIR}/tmp/.nova-update-applied"
ROLLBACK_DONE_MARKER="${ROOT_DIR}/tmp/.nova-update-rolled-back"

read_prev_sha_from_marker() {
  if [[ ! -f "${ROLLBACK_MARKER}" ]]; then
    return 1
  fi
  PREV_SHA="$(grep -E '^prev_sha=' "${ROLLBACK_MARKER}" 2>/dev/null | head -1 | sed 's/^prev_sha=//')"
  [[ -n "${PREV_SHA}" ]]
}

rollback_to_last_good() {
  if ! read_prev_sha_from_marker; then
    echo "rollback: no usable prev_sha marker; clearing marker only"
    rm -f "${ROLLBACK_MARKER}"
    return 0
  fi
  echo "rollback: agent never came back healthy after update; resetting repo to ${PREV_SHA}"
  (
    cd "${ROOT_DIR}" || exit 0
    git reset --hard "${PREV_SHA}" || echo "rollback: git reset --hard failed (continuing)"
    run_pnpm install || echo "rollback: pnpm install failed (continuing)"
  )
  if [[ -n "${NOVA_REPO_GIT_CHOWN:-}" ]]; then
    chown -R "${NOVA_REPO_GIT_CHOWN}" "${ROOT_DIR}/.git" 2>/dev/null || true
  fi
  date -u +"%Y-%m-%dT%H:%M:%SZ rolled-back-to=${PREV_SHA}" > "${ROLLBACK_DONE_MARKER}" 2>/dev/null || true
  rm -f "${ROLLBACK_MARKER}"
  rm -rf "${ROOT_DIR}/apps/web/.next" 2>/dev/null || true
}

# Drop stale markers older than 24h — an old marker means the supervisor never restarted
# to do its post-update probe, so the agent has obviously been running fine on the new commit.
prune_stale_rollback_marker() {
  if [[ ! -f "${ROLLBACK_MARKER}" ]]; then
    return 0
  fi
  local mtime now age
  mtime="$(stat -f %m "${ROLLBACK_MARKER}" 2>/dev/null || stat -c %Y "${ROLLBACK_MARKER}" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  age=$((now - mtime))
  if [[ "${age}" -gt 86400 ]]; then
    echo "rollback: clearing stale update marker (age=${age}s)"
    rm -f "${ROLLBACK_MARKER}"
  fi
}

trap 'echo "Stopping Nova local stack..."; cleanup; exit 0' INT TERM

echo "Starting Nova local stack supervisor..."
echo "This script now auto-restarts services after update-triggered exits."
echo "Tip: if agent-core fails with EADDRINUSE on 8787, another Nova (or stale tsx) is still running, or use NOVA_LOCAL_FREE_PORTS=1 once to clear 8787 and the web port."

if ! command -v corepack >/dev/null 2>&1 && ! command -v pnpm >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; then
  echo "Error: none of corepack, pnpm, or npm was found in PATH (${PATH})."
  echo "Install Node.js (includes npm), then restart the service."
  exit 1
fi

if https_enabled; then
  mkdir -p "$(dirname "${HTTPS_CERT_PATH}")"
  mkdir -p "$(dirname "${HTTPS_KEY_PATH}")"
  if [[ ! -f "${HTTPS_CERT_PATH}" || ! -f "${HTTPS_KEY_PATH}" ]]; then
    echo "HTTPS requested; generating self-signed cert for local/LAN dev..."
    if ! command -v openssl >/dev/null 2>&1; then
      echo "Error: openssl is required for NOVA_WEB_HTTPS=true but was not found."
      echo "Install OpenSSL, or provide NOVA_WEB_HTTPS_CERT and NOVA_WEB_HTTPS_KEY paths."
      exit 1
    fi
    NOVA_TLS_SAN_BASE="DNS:localhost,IP:127.0.0.1"
    if [[ -n "${NOVA_WEB_TLS_SAN:-}" ]]; then
      NOVA_TLS_SAN="${NOVA_TLS_SAN_BASE},${NOVA_WEB_TLS_SAN}"
    else
      NOVA_TLS_SAN="${NOVA_TLS_SAN_BASE}"
    fi
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
      -keyout "${HTTPS_KEY_PATH}" \
      -out "${HTTPS_CERT_PATH}" \
      -subj "/CN=Nova Local Dev" \
      -addext "subjectAltName=${NOVA_TLS_SAN}" >/dev/null 2>&1
  fi
  echo "Web UI HTTPS enabled on https://${WEB_HOST}:${WEB_PORT}"
  echo "Cert: ${HTTPS_CERT_PATH}"
  echo "If browsers reject the cert on LAN, set NOVA_WEB_TLS_SAN=IP:<this-host-ip>[,DNS:<hostname>], delete the cert/key files above, and restart so a new cert is generated."
fi

while true; do
  FLAG="${ROOT_DIR}/tmp/.nova-clean-web-next"
  if [[ -f "${FLAG}" ]]; then
    rm -f "${FLAG}"
    rm -rf "${ROOT_DIR}/apps/web/.next"
    echo "Cleared apps/web/.next after in-app update (avoids stale Next dev chunks)."
  fi

  prune_stale_rollback_marker

  POST_UPDATE_PROBE=0
  if [[ -f "${ROLLBACK_MARKER}" ]]; then
    POST_UPDATE_PROBE=1
    echo "post-update health probe armed (marker: ${ROLLBACK_MARKER})"
  fi

  free_tcp_port_if_requested

  echo "Launching agent-core and web..."
  (
    cd "${ROOT_DIR}"
    run_pnpm --filter @nova/agent-core dev
  ) &
  AGENT_PID=$!

  # Do not use `pnpm run dev -- ...`: pnpm forwards `--` to the script, and Next.js
  # treats everything after `--` as positional args, so `--hostname` is misread as [directory].
  (
    cd "${ROOT_DIR}/apps/web"
    export PORT="${WEB_PORT}"
    if https_enabled; then
      run_pnpm exec next dev \
        -H "${WEB_HOST}" \
        -p "${WEB_PORT}" \
        --experimental-https \
        --experimental-https-cert "${HTTPS_CERT_PATH}" \
        --experimental-https-key "${HTTPS_KEY_PATH}"
    else
      run_pnpm exec next dev -H "${WEB_HOST}" -p "${WEB_PORT}"
    fi
  ) &
  WEB_PID=$!

  echo "agent-core PID ${AGENT_PID}, web PID ${WEB_PID}"

  # If either process exits (for example after update apply), restart both.
  AGENT_HEALTH_FAILS=0
  if [[ "${POST_UPDATE_PROBE}" -eq 1 ]]; then
    # First boot after an update may take longer (cold install, fresh tsx watch warmup).
    AGENT_HEALTH_GRACE_UNTIL=$((SECONDS + ${NOVA_POST_UPDATE_GRACE_SECONDS:-90}))
    AGENT_HEALTH_FAIL_THRESHOLD="${NOVA_POST_UPDATE_FAIL_THRESHOLD:-6}"
  else
    # Steady-state: tsx watch occasionally drops port 8787 for ~3-10s while it recompiles after
    # a `git pull` or file edit. With the previous default of 3 fails × 5s = 15s tolerance the
    # supervisor would tear down the entire stack mid-recompile, wiping the in-memory channel
    # debug buffer. 6 fails × 5s = 30s of downtime is more than enough to cover any normal hot
    # reload, and a real hang still gets caught within a minute.
    AGENT_HEALTH_GRACE_UNTIL=$((SECONDS + ${NOVA_AGENT_HEALTH_GRACE_SECONDS:-45}))
    AGENT_HEALTH_FAIL_THRESHOLD="${NOVA_AGENT_HEALTH_FAIL_THRESHOLD:-6}"
  fi
  AGENT_HEALTH_EVERY_SECONDS="${NOVA_AGENT_HEALTH_EVERY_SECONDS:-5}"
  NEXT_AGENT_HEALTH_AT=0
  POST_UPDATE_DEADLINE=$((SECONDS + ${NOVA_POST_UPDATE_DEADLINE_SECONDS:-300}))
  while true; do
    if ! kill -0 "${AGENT_PID}" 2>/dev/null; then
      if [[ "${POST_UPDATE_PROBE}" -eq 1 ]]; then
        echo "post-update: agent-core process died; rolling back to last known good commit"
        cleanup
        rollback_to_last_good
        break
      fi
      echo "agent-core exited; restarting full stack..."
      cleanup
      break
    fi
    if ! kill -0 "${WEB_PID}" 2>/dev/null; then
      if [[ "${POST_UPDATE_PROBE}" -eq 1 ]]; then
        echo "post-update: web process died; rolling back to last known good commit"
        cleanup
        rollback_to_last_good
        break
      fi
      echo "web exited; restarting full stack..."
      cleanup
      break
    fi
    if [[ "${SECONDS}" -ge "${AGENT_HEALTH_GRACE_UNTIL}" && "${SECONDS}" -ge "${NEXT_AGENT_HEALTH_AT}" ]]; then
      NEXT_AGENT_HEALTH_AT=$((SECONDS + AGENT_HEALTH_EVERY_SECONDS))
      if agent_http_healthy; then
        AGENT_HEALTH_FAILS=0
        if [[ "${POST_UPDATE_PROBE}" -eq 1 ]]; then
          echo "post-update: agent-core healthy on port ${AGENT_PORT}; clearing rollback marker"
          rm -f "${ROLLBACK_MARKER}"
          POST_UPDATE_PROBE=0
        fi
      elif agent_busy_with_chat; then
        # Don't penalise a slow /health when agent-core is genuinely busy answering a chat. Keep the
        # counter at most one below the threshold so a real hang still triggers within ~5 s.
        if [[ "${AGENT_HEALTH_FAILS}" -gt 0 ]]; then
          AGENT_HEALTH_FAILS=$((AGENT_HEALTH_FAILS - 1))
        fi
        echo "agent-core health probe missed but heartbeat reports busy=true; skipping restart on port ${AGENT_PORT}"
      else
        AGENT_HEALTH_FAILS=$((AGENT_HEALTH_FAILS + 1))
        echo "agent-core health check failed (${AGENT_HEALTH_FAILS}/${AGENT_HEALTH_FAIL_THRESHOLD}) on port ${AGENT_PORT}"
        if [[ "${AGENT_HEALTH_FAILS}" -ge "${AGENT_HEALTH_FAIL_THRESHOLD}" ]]; then
          if [[ "${POST_UPDATE_PROBE}" -eq 1 ]]; then
            echo "post-update: agent-core repeatedly unhealthy; rolling back to last known good commit"
            cleanup
            rollback_to_last_good
            break
          fi
          echo "agent-core process is alive but HTTP is unavailable; restarting full stack..."
          cleanup
          break
        fi
      fi
    fi
    # Hard deadline: if the post-update stack hasn't hit healthy by NOVA_POST_UPDATE_DEADLINE_SECONDS, force rollback.
    if [[ "${POST_UPDATE_PROBE}" -eq 1 && "${SECONDS}" -ge "${POST_UPDATE_DEADLINE}" ]]; then
      echo "post-update: deadline exceeded without sustained healthy probe; rolling back"
      cleanup
      rollback_to_last_good
      break
    fi
    sleep 1
  done

  sleep "${RESTART_DELAY_SECONDS}"
done
