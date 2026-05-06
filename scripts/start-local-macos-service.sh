#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Prefer Wi-Fi IP for SAN; fallback to localhost only when unavailable.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
TLS_SAN="IP:127.0.0.1"
if [[ -n "${LAN_IP}" ]]; then
  TLS_SAN="${TLS_SAN},IP:${LAN_IP}"
fi

export NOVA_WEB_HTTPS=true
export NOVA_WEB_STANDARD_PORTS=1
export NOVA_WEB_TLS_SAN="${TLS_SAN}"

# When Nova runs as a per-user LaunchAgent (non-root), binding to 443 will fail and cause a restart loop.
# Keep the LaunchDaemon path on 443, but force a safe unprivileged port for the LaunchAgent fallback.
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  export NOVA_WEB_PORT="${NOVA_WEB_PORT:-3000}"
  export NOVA_WEB_STANDARD_PORTS=0
fi

exec /bin/bash "${ROOT_DIR}/scripts/start-local.sh"
