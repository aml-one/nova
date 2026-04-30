#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESTART_DELAY_SECONDS=2

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

while true; do
  echo "Launching agent-core and web..."
  (
    cd "${ROOT_DIR}"
    corepack pnpm --filter @nova/agent-core dev
  ) &
  AGENT_PID=$!

  (
    cd "${ROOT_DIR}"
    corepack pnpm --filter @nova/web dev
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
