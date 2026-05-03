#!/usr/bin/env bash
# Native Orpheus-FastAPI + Homebrew llama-server on macOS (Metal).
# Downloads a quantized GGUF if missing, starts inference on :5006 and API on :5005.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

MODEL_FILE="${ORPHEUS_MODEL_FILE:-Orpheus-3b-FT-Q2_K.gguf}"
MODEL_DIR="${ORPHEUS_MODEL_DIR:-$HOME/nova-deps/orpheus-models}"
ORPHEUS_HOME="${ORPHEUS_HOME:-$HOME/nova-deps/Orpheus-FastAPI}"
VENV="${ORPHEUS_VENV:-$HOME/nova-deps/orpheus-venv}"
CTX="${ORPHEUS_MAX_TOKENS:-8192}"
INF_PORT="${LLAMA_SERVER_PORT:-5006}"
API_PORT="${ORPHEUS_PORT:-5005}"

mkdir -p "$MODEL_DIR"
MP="$MODEL_DIR/$MODEL_FILE"
if [[ ! -f "$MP" ]]; then
  echo "==> Downloading $MODEL_FILE into $MODEL_DIR (can take several minutes)..."
  curl -fL --retry 5 --retry-delay 10 --continue-at - \
    "https://huggingface.co/lex-au/${MODEL_FILE}/resolve/main/${MODEL_FILE}" \
    -o "$MP.partial" && mv "$MP.partial" "$MP"
fi

echo "==> Stopping prior llama-server (:$INF_PORT) / Orpheus (:$API_PORT)"
pkill -f "llama-server.*--port ${INF_PORT}" 2>/dev/null || true
pkill -f "uvicorn.*:${API_PORT}" 2>/dev/null || true
pkill -f "python.*app.py.*${API_PORT}" 2>/dev/null || true
sleep 2

echo "==> Starting llama-server on 127.0.0.1:$INF_PORT"
nohup llama-server \
  -m "$MP" \
  --host 127.0.0.1 \
  --port "$INF_PORT" \
  --ctx-size "$CTX" \
  --n-predict "$CTX" \
  --rope-scaling linear \
  >/tmp/llama-orpheus.log 2>&1 &
sleep 6
if ! curl -fsS -m 5 "http://127.0.0.1:${INF_PORT}/health" >/dev/null 2>&1 && ! curl -fsS -m 5 "http://127.0.0.1:${INF_PORT}/v1/models" >/dev/null 2>&1; then
  echo "WARN: inference HTTP probe failed; see /tmp/llama-orpheus.log"
  tail -30 /tmp/llama-orpheus.log || true
fi

echo "==> Orpheus-FastAPI .env"
mkdir -p "$ORPHEUS_HOME"
cd "$ORPHEUS_HOME"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
API_URL_MAC="http://127.0.0.1:${INF_PORT}/v1/completions"
ETMP="$(mktemp)"
cp .env "$ETMP"
for key in ORPHEUS_API_URL ORPHEUS_MODEL_NAME ORPHEUS_MAX_TOKENS ORPHEUS_PORT ORPHEUS_HOST; do
  grep -v "^${key}=" "$ETMP" >"${ETMP}.2" && mv "${ETMP}.2" "$ETMP"
done
mv "$ETMP" .env
{
  echo "ORPHEUS_API_URL=$API_URL_MAC"
  echo "ORPHEUS_MODEL_NAME=$MODEL_FILE"
  echo "ORPHEUS_MAX_TOKENS=$CTX"
  echo "ORPHEUS_PORT=$API_PORT"
  echo "ORPHEUS_HOST=0.0.0.0"
} >>.env

echo "==> Python deps (venv)"
# shellcheck disable=SC1090
source "$VENV/bin/activate"
pip install -q -r requirements.txt

echo "==> Starting Orpheus-FastAPI on :$API_PORT"
nohup uvicorn app:app --host 0.0.0.0 --port "$API_PORT" >/tmp/orpheus-fastapi.log 2>&1 &
sleep 10
if curl -fsS -m 10 "http://127.0.0.1:${API_PORT}/docs" >/dev/null; then
  echo "OK Orpheus docs http://127.0.0.1:${API_PORT}/docs"
else
  echo "WARN Orpheus failed to expose /docs — tail /tmp/orpheus-fastapi.log"
  tail -40 /tmp/orpheus-fastapi.log || true
  exit 1
fi
