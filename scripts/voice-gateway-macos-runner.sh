#!/usr/bin/env bash
# Run by launchd (com.nova.voice-gateway). Ensures venv + deps, then execs the gateway.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

# shellcheck source=/dev/null
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env"
  set +a
fi

export NOVA_AGENT_BASE="${NOVA_AGENT_BASE:-http://127.0.0.1:8787}"
export NOVA_VOICE_HOST="${NOVA_VOICE_HOST:-0.0.0.0}"
export NOVA_VOICE_PORT="${NOVA_VOICE_PORT:-8790}"

PY=""
if [[ -x "/opt/homebrew/bin/python3.11" ]]; then
  PY="/opt/homebrew/bin/python3.11"
elif [[ -x "/usr/local/bin/python3.11" ]]; then
  PY="/usr/local/bin/python3.11"
else
  PY="python3"
fi

GW="${ROOT_DIR}/apps/voice-webrtc-gateway"
cd "${GW}"

if [[ ! -d .venv ]]; then
  "${PY}" -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt

exec .venv/bin/python main.py
