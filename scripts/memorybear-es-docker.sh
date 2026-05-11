#!/usr/bin/env bash
# (Re)start the single-node Elasticsearch container MemoryBear expects on the host (default :9201 → :9200).
# Safe to re-run; removes any existing nova-es. Requires Docker (Desktop or Colima).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
MB_ES_HOST_PORT="${MB_ES_HOST_PORT:-9201}"
if [[ -z "${DOCKER_HOST:-}" && -S "${HOME}/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
fi
docker rm -f nova-es >/dev/null 2>&1 || true
docker run -d --name nova-es -p "${MB_ES_HOST_PORT}:9200" \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS="-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0
echo "nova-es up; waiting for HTTP on :${MB_ES_HOST_PORT} …"
for _ in $(seq 1 24); do
  if curl -fsS -m 3 "http://127.0.0.1:${MB_ES_HOST_PORT}/" >/dev/null 2>&1; then
    echo "Elasticsearch OK at http://127.0.0.1:${MB_ES_HOST_PORT}/"
    exit 0
  fi
  sleep 5
done
echo "WARN: ES did not become ready in time. Check: docker logs nova-es"
exit 1
