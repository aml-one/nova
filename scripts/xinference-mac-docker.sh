#!/usr/bin/env bash
# Start Xinference in Docker for MemoryBear rerank (provider "xinference", base http://127.0.0.1:<port>).
# MemoryBear only supports rerank via xinference / gpustack / dashscope — not Ollama/OpenAI.
#
# Usage (from Nova repo on macOS):
#   bash scripts/xinference-mac-docker.sh
#
# Env (optional):
#   XINFERENCE_HOST_PORT     host port (default 9997)
#   XINFERENCE_DATA_DIR      host dir for XINFERENCE_HOME (default ~/xinference-docker-data)
#   XINFERENCE_DOCKER_IMAGE  image (default xprobe/xinference:latest)
#   XINFERENCE_CONTAINER_NAME (default nova-xinference)
#   XINFERENCE_USE_NVIDIA_GPU=1  add --gpus all (Linux + NVIDIA only; not typical on Mac)
#
# After the UI is up: open http://127.0.0.1:<port> , launch a rerank model, copy its model UID into MemoryBear.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
if [[ -z "${DOCKER_HOST:-}" && -S "${HOME}/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
fi

XINFERENCE_HOST_PORT="${XINFERENCE_HOST_PORT:-9997}"
XINFERENCE_DATA_DIR="${XINFERENCE_DATA_DIR:-"${HOME}/xinference-docker-data"}"
XINFERENCE_DOCKER_IMAGE="${XINFERENCE_DOCKER_IMAGE:-xprobe/xinference:latest}"
XINFERENCE_CONTAINER_NAME="${XINFERENCE_CONTAINER_NAME:-nova-xinference}"

mkdir -p "${XINFERENCE_DATA_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Install Docker Desktop or Colima, then re-run."
  exit 1
fi

GPU_ARGS=()
if [[ "${XINFERENCE_USE_NVIDIA_GPU:-0}" == "1" ]]; then
  GPU_ARGS=(--gpus all)
fi

echo "Pulling ${XINFERENCE_DOCKER_IMAGE} (first time can take a while) …"
docker pull "${XINFERENCE_DOCKER_IMAGE}"

docker rm -f "${XINFERENCE_CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "Starting ${XINFERENCE_CONTAINER_NAME} on host port ${XINFERENCE_HOST_PORT} …"
# shellcheck disable=SC2086
docker run -d --name "${XINFERENCE_CONTAINER_NAME}" \
  -p "${XINFERENCE_HOST_PORT}:9997" \
  -e XINFERENCE_HOME=/data \
  -v "${XINFERENCE_DATA_DIR}:/data" \
  "${GPU_ARGS[@]}" \
  "${XINFERENCE_DOCKER_IMAGE}" \
  xinference-local -H 0.0.0.0

base="http://127.0.0.1:${XINFERENCE_HOST_PORT}"
echo "Waiting for Xinference HTTP on ${base} …"
for i in $(seq 1 36); do
  if curl -fsS -m 5 "${base}/v1/models" >/dev/null 2>&1 || curl -fsS -m 5 "${base}/docs" >/dev/null 2>&1; then
    echo ""
    echo "Xinference is responding."
    echo ""
    echo "Next steps (MemoryBear rerank):"
    echo "  1. Open ${base} in a browser and launch a rerank model (e.g. a BGE reranker)."
    echo "  2. In MemoryBear, add a rerank model: provider xinference, API base ${base}, model name = the model UID from Xinference."
    echo "  3. Optional: set XINFERENCE_URL=${base} in MemoryBear api/.env if you use upstream features that read it."
    echo ""
    echo "Logs: docker logs -f ${XINFERENCE_CONTAINER_NAME}"
    echo "Stop:  docker rm -f ${XINFERENCE_CONTAINER_NAME}"
    exit 0
  fi
  if [[ "${i}" -eq 1 ]] || [[ $((i % 6)) -eq 0 ]]; then
    echo "  … still starting (${i}/36) — first boot downloads models; CPU-only Mac can be slow."
  fi
  sleep 5
done

echo "WARN: Xinference did not respond in time. Check: docker logs ${XINFERENCE_CONTAINER_NAME}"
exit 1
