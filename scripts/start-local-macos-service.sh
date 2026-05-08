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

# WebUI (Next.js) and agent-core run on the same Mac here; Node must reach agent-core via loopback.
# (A hostname like `nova` is for browsers on the LAN — it is not always resolvable from Node's fetch.)
export NOVA_AGENT_API_COLOCATED="${NOVA_AGENT_API_COLOCATED:-1}"
export NOVA_AGENT_API_URL="${NOVA_AGENT_API_URL:-http://127.0.0.1:8787}"

exec /bin/bash "${ROOT_DIR}/scripts/start-local.sh"
