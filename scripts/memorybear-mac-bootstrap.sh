#!/usr/bin/env bash
# Bootstrap MemoryBear on macOS with Homebrew Postgres, Redis, and Neo4j (no Docker for Neo4j).
# Usage (on the Mac): bash scripts/memorybear-mac-bootstrap.sh
# Or from repo root: ssh user@host 'bash -s' < scripts/memorybear-mac-bootstrap.sh
#
# Default password for Postgres role, Neo4j, and MemoryBear superuser: NovaPassword7880
# Override: MB_PASSWORD='your-secret' bash scripts/memorybear-mac-bootstrap.sh

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
MB_PASSWORD="${MB_PASSWORD:-NovaPassword7880}"
MB_DIR="${MB_DIR:-$HOME/nova-deps/MemoryBear/api}"
# Host port for Elasticsearch HTTP (container still listens on 9200). Default 9201 avoids a stale
# Docker Desktop proxy often holding *:9200 on macOS while Colima runs the real ES container.
MB_ES_HOST_PORT="${MB_ES_HOST_PORT:-9201}"
SECRET_KEY="${SECRET_KEY:-$(openssl rand -hex 32)}"
U="$(whoami)"

echo "==> Starting Homebrew services (postgresql@16, redis, neo4j)"
brew services start postgresql@16 || true
brew services start redis || true
brew services start neo4j || true
sleep 3

echo "==> Postgres: set password for role $U and create database redbear-mem"
psql postgres -v ON_ERROR_STOP=1 -c "ALTER USER \"$U\" WITH PASSWORD '$MB_PASSWORD';" || true
createdb redbear-mem 2>/dev/null || true

echo "==> Neo4j: ensure password (ignore errors if already set)"
if command -v cypher-shell >/dev/null 2>&1; then
  cypher-shell -a bolt://127.0.0.1:7687 -u neo4j -p "$MB_PASSWORD" "RETURN 1 AS ok;" >/dev/null 2>&1 || \
  cypher-shell -a bolt://127.0.0.1:7687 -u neo4j -p neo4j "ALTER CURRENT USER SET PASSWORD FROM 'neo4j' TO '$MB_PASSWORD';" 2>/dev/null || \
  cypher-shell -a bolt://127.0.0.1:7687 -u neo4j -p neo4j "CALL dbms.security.changePassword('$MB_PASSWORD');" 2>/dev/null || true
fi

echo "==> libmagic (python-magic) for MemoryBear API"
brew list libmagic >/dev/null 2>&1 || brew install libmagic

echo "==> Elasticsearch on host :${MB_ES_HOST_PORT} -> container :9200 (Docker + Colima if available)"
if command -v docker >/dev/null 2>&1; then
  export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"
  if docker info >/dev/null 2>&1; then
    docker rm -f nova-es >/dev/null 2>&1 || true
    docker run -d --name nova-es -p "${MB_ES_HOST_PORT}:9200" \
      -e discovery.type=single-node -e xpack.security.enabled=false \
      -e ES_JAVA_OPTS="-Xms512m -Xmx512m" \
      docker.elastic.co/elasticsearch/elasticsearch:8.11.0 >/dev/null 2>&1 || true
    echo "    Waiting for Elasticsearch (up to 90s)..."
    for _ in $(seq 1 18); do
      curl -fsS "http://127.0.0.1:${MB_ES_HOST_PORT}" >/dev/null 2>&1 && break
      sleep 5
    done
  else
    echo "WARN: docker not reachable (start Colima: colima start --runtime docker). Set ELASTICSEARCH_HOST=http://127.0.0.1 yourself if ES runs elsewhere."
  fi
fi

echo "==> Writing $MB_DIR/.env"
mkdir -p "$MB_DIR"
cat >"$MB_DIR/.env" <<EOF
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=$MB_PASSWORD
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=$U
DB_PASSWORD=$MB_PASSWORD
DB_NAME=redbear-mem
DB_AUTO_UPGRADE=true
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=1
REDIS_PASSWORD=
REDIS_DB_CELERY_BROKER=3
REDIS_DB_CELERY_BACKEND=4
SECRET_KEY=$SECRET_KEY
LOAD_MODEL=false
ENABLE_GENERAL_ONTOLOGY_TYPES=false
FIRST_SUPERUSER_EMAIL=admin@example.com
FIRST_SUPERUSER_USERNAME=admin
FIRST_SUPERUSER_PASSWORD=$MB_PASSWORD
ELASTICSEARCH_HOST=http://127.0.0.1
ELASTICSEARCH_PORT=${MB_ES_HOST_PORT}
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=
ELASTICSEARCH_VERIFY_CERTS=false
EOF

cd "$MB_DIR"
echo "==> Alembic migrate"
uv run alembic upgrade head

echo "==> Starting API on :8000 (background)"
pkill -f "uv run -m app.main" 2>/dev/null || true
sleep 1
export DYLD_LIBRARY_PATH="${DYLD_LIBRARY_PATH:-/opt/homebrew/lib}"
nohup env DYLD_LIBRARY_PATH="$DYLD_LIBRARY_PATH" uv run -m app.main > /tmp/memorybear-api.log 2>&1 &
sleep 15

echo "==> Initial superuser + API key"
curl -fsS -X POST "http://127.0.0.1:8000/api/setup" -H "Content-Type: application/json" || true
TOKEN_JSON="$(curl -fsS -X POST "http://127.0.0.1:8000/api/token" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"$MB_PASSWORD\"}")"
TOKEN="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('access_token',''))" <<<"$TOKEN_JSON")"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: could not obtain JWT. See /tmp/memorybear-api.log"
  exit 1
fi

WS_JSON="$(curl -fsS "http://127.0.0.1:8000/api/workspaces" -H "Authorization: Bearer $TOKEN")"
WS_ID="$(python3 -c "import json,sys; d=json.load(sys.stdin); arr=d.get('data') or []; print(arr[0]['id'] if arr else '')" <<<"$WS_JSON")"
if [[ -z "$WS_ID" ]]; then
  echo "==> No workspace yet; creating default workspace (superuser)"
  CREATE_JSON="$(curl -fsS -X POST "http://127.0.0.1:8000/api/workspaces" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"Nova\",\"description\":\"Created by memorybear-mac-bootstrap.sh\"}")"
  WS_ID="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" <<<"$CREATE_JSON")"
fi
if [[ -n "$WS_ID" ]]; then
  curl -fsS -X PUT "http://127.0.0.1:8000/api/workspaces/$WS_ID/switch" -H "Authorization: Bearer $TOKEN" >/dev/null || true
fi

KEY_JSON="$(curl -fsS -X POST "http://127.0.0.1:8000/api/apikeys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Nova","type":"service","scopes":["memory"],"description":"Nova agent integration"}')"
API_KEY="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('api_key',''))" <<<"$KEY_JSON")"
if [[ -z "$API_KEY" ]]; then
  echo "WARN: API key creation failed (maybe key already exists). Create one in MemoryBear UI."
else
  KEYFILE="${KEYFILE:-$HOME/nova-deps/memorybear-nova-api-key.txt}"
  echo "$API_KEY" >"$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "Wrote API key to $KEYFILE"
fi

echo "Done. MemoryBear API: http://127.0.0.1:8000/docs"
echo "Logs: tail -f /tmp/memorybear-api.log"
echo "In Nova Settings → Memory & cores, enable MemoryBear and paste the API key; base URL http://127.0.0.1:8000"
