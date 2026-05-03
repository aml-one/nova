#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESTART_DELAY_SECONDS=2
WEB_PORT="${NOVA_WEB_PORT:-3000}"
WEB_HOST="${NOVA_WEB_HOST:-0.0.0.0}"
ENABLE_HTTPS="${NOVA_WEB_HTTPS:-false}"
HTTPS_CERT_PATH="${NOVA_WEB_HTTPS_CERT:-${ROOT_DIR}/tmp/dev-cert.pem}"
HTTPS_KEY_PATH="${NOVA_WEB_HTTPS_KEY:-${ROOT_DIR}/tmp/dev-key.pem}"

AGENT_PID=""
WEB_PID=""

cleanup() {
  if [[ -n "${AGENT_PID}" ]] && kill -0 "${AGENT_PID}" 2>/dev/null; then
    kill "${AGENT_PID}" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi
}

trap 'echo "Stopping Nova local stack..."; cleanup; exit 0' INT TERM

echo "Starting Nova local stack supervisor..."
echo "This script now auto-restarts services after update-triggered exits."

if [[ "${ENABLE_HTTPS,,}" == "true" ]]; then
  mkdir -p "$(dirname "${HTTPS_CERT_PATH}")"
  mkdir -p "$(dirname "${HTTPS_KEY_PATH}")"
  if [[ ! -f "${HTTPS_CERT_PATH}" || ! -f "${HTTPS_KEY_PATH}" ]]; then
    echo "HTTPS requested; generating self-signed cert for local/LAN dev..."
    if ! command -v openssl >/dev/null 2>&1; then
      echo "Error: openssl is required for NOVA_WEB_HTTPS=true but was not found."
      echo "Install OpenSSL, or provide NOVA_WEB_HTTPS_CERT and NOVA_WEB_HTTPS_KEY paths."
      exit 1
    fi
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
      -keyout "${HTTPS_KEY_PATH}" \
      -out "${HTTPS_CERT_PATH}" \
      -subj "/CN=Nova Local Dev" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0" >/dev/null 2>&1
  fi
  echo "Web UI HTTPS enabled on https://${WEB_HOST}:${WEB_PORT}"
  echo "Cert: ${HTTPS_CERT_PATH}"
fi

while true; do
  FLAG="${ROOT_DIR}/tmp/.nova-clean-web-next"
  if [[ -f "${FLAG}" ]]; then
    rm -f "${FLAG}"
    rm -rf "${ROOT_DIR}/apps/web/.next"
    echo "Cleared apps/web/.next after in-app update (avoids stale Next dev chunks)."
  fi

  echo "Launching agent-core and web..."
  (
    cd "${ROOT_DIR}"
    corepack pnpm --filter @nova/agent-core dev
  ) &
  AGENT_PID=$!

  (
    cd "${ROOT_DIR}"
    if [[ "${ENABLE_HTTPS,,}" == "true" ]]; then
      PORT="${WEB_PORT}" HOSTNAME="${WEB_HOST}" corepack pnpm --filter @nova/web dev -- \
        --hostname "${WEB_HOST}" \
        --port "${WEB_PORT}" \
        --experimental-https \
        --experimental-https-cert "${HTTPS_CERT_PATH}" \
        --experimental-https-key "${HTTPS_KEY_PATH}"
    else
      PORT="${WEB_PORT}" HOSTNAME="${WEB_HOST}" corepack pnpm --filter @nova/web dev -- --hostname "${WEB_HOST}" --port "${WEB_PORT}"
    fi
  ) &
  WEB_PID=$!

  echo "agent-core PID ${AGENT_PID}, web PID ${WEB_PID}"

  # If either process exits (for example after update apply), restart both.
  while true; do
    if ! kill -0 "${AGENT_PID}" 2>/dev/null; then
      echo "agent-core exited; restarting full stack..."
      cleanup
      break
    fi
    if ! kill -0 "${WEB_PID}" 2>/dev/null; then
      echo "web exited; restarting full stack..."
      cleanup
      break
    fi
    sleep 1
  done

  sleep "${RESTART_DELAY_SECONDS}"
done
