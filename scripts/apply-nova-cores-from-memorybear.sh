#!/usr/bin/env bash
# After MemoryBear bootstrap: PATCH Nova agent-core settings (MemoryBear + optional SentiCore path).
# Requires: NOVA_API_TOKEN in env or in repo root .env; agent on 127.0.0.1:8787
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
NOVA_ROOT="${NOVA_ROOT:-$HOME/projects/Nova}"
KEYFILE="${KEYFILE:-$HOME/nova-deps/memorybear-nova-api-key.txt}"
AGENT_URL="${AGENT_URL:-http://127.0.0.1:8787}"
ORPHEUS_URL="${ORPHEUS_URL:-http://127.0.0.1:5005}"

SC_PATH=""
for cand in \
  "$HOME/nova-deps/SentiCore/docs/hermes-senticore-guide.md" \
  "$HOME/nova-deps/SentiCore/SOUL.md" \
  "$HOME/nova-deps/SentiCore/README.md"; do
  if [[ -f "$cand" ]]; then
    SC_PATH="$cand"
    break
  fi
done
if [[ -n "${SENTICORE_MD:-}" && -f "$SENTICORE_MD" ]]; then
  SC_PATH="$SENTICORE_MD"
fi

if [[ -f "$NOVA_ROOT/.env" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$NOVA_ROOT/.env" && set +a || true
fi
if [[ -z "${NOVA_API_TOKEN:-}" ]]; then
  echo "ERROR: set NOVA_API_TOKEN or add it to $NOVA_ROOT/.env"
  exit 1
fi
if [[ ! -f "$KEYFILE" ]]; then
  echo "ERROR: MemoryBear API key file not found: $KEYFILE (run memorybear-mac-bootstrap.sh first)"
  exit 1
fi
API_KEY="$(tr -d '\r\n' <"$KEYFILE")"

ORPHEUS_ENABLED_FLAG="${ORPHEUS_ENABLED:-}"
if [[ "$ORPHEUS_ENABLED_FLAG" == "auto" || -z "$ORPHEUS_ENABLED_FLAG" ]]; then
  if curl -fsS -m 5 "${ORPHEUS_URL}/docs" >/dev/null 2>&1; then
    ORPHEUS_ENABLED_FLAG="1"
  else
    ORPHEUS_ENABLED_FLAG="0"
  fi
fi

export AGENT_URL NOVA_API_TOKEN API_KEY SC_PATH ORPHEUS_URL ORPHEUS_ENABLED_FLAG

python3 <<'PY'
import json, os, urllib.request

agent = os.environ["AGENT_URL"]
token = os.environ["NOVA_API_TOKEN"]
api_key = os.environ["API_KEY"]
sc_path = os.environ.get("SC_PATH", "")
orpheus_url = os.environ.get("ORPHEUS_URL", "http://127.0.0.1:5005").rstrip("/")
orpheus_on = os.environ.get("ORPHEUS_ENABLED_FLAG", "0") == "1"

patch = {
  "memoryBear": {
    "enabled": True,
    "baseUrl": "http://127.0.0.1:8000",
    "apiKey": api_key,
    "searchSwitch": "2",
    "storageType": "neo4j",
    "syncWrites": True,
  },
  "emotions": {"enabled": True, "expressionStyle": "balanced", "mirrorUserValence": True},
  "sentiCore": {"enabled": bool(sc_path.strip()), "orchestrationMarkdownPath": sc_path},
  "orpheusTts": {
    "enabled": orpheus_on,
    "baseUrl": orpheus_url,
    "apiKey": "",
    "voice": "tara",
    "model": "orpheus",
    "responseFormat": "wav",
  },
}

req = urllib.request.Request(
    f"{agent}/v1/settings",
    data=json.dumps(patch).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="PUT",
)
with urllib.request.urlopen(req, timeout=30) as r:
    body = r.read().decode()
print(body[:800])
PY
