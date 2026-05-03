#!/usr/bin/env bash
# Ask agent-core to exit (supervisor/systemd/user shell usually restarts it).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
NOVA_ROOT="${NOVA_ROOT:-$HOME/projects/Nova}"
AGENT_URL="${AGENT_URL:-http://127.0.0.1:8787}"

if [[ -f "$NOVA_ROOT/.env" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$NOVA_ROOT/.env" && set +a || true
fi
if [[ -z "${NOVA_API_TOKEN:-}" ]]; then
  echo "ERROR: NOVA_API_TOKEN missing (expected in $NOVA_ROOT/.env)"
  exit 1
fi

echo "==> Restart agent-core via $AGENT_URL/v1/system/restart"
curl -fsS -X POST "${AGENT_URL}/v1/system/restart" \
  -H "Authorization: Bearer ${NOVA_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"service":"agent-core"}'
echo
ok=0
for ((i = 1; i <= 30; i++)); do
  if curl -fsS -m 5 "${AGENT_URL}/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" -eq 1 ]]; then
  curl -fsS -m 5 "${AGENT_URL}/health" && echo "OK agent health"
else
  echo "WARN: agent health not ready after restart; check agent logs / supervisor"
  exit 1
fi
