#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Starting Nova in production mode..."

(
  cd "$ROOT_DIR/apps/agent-core"
  node dist/index.js
) &
AGENT_PID=$!

(
  cd "$ROOT_DIR/apps/web"
  PORT="${NOVA_WEB_PORT:-3000}" corepack pnpm --filter @nova/web start -- -p "$PORT"
) &
WEB_PID=$!

echo "Nova started: agent-core PID=$AGENT_PID web PID=$WEB_PID"

cleanup() {
  echo "Stopping Nova..."
  kill "$AGENT_PID" "$WEB_PID" 2>/dev/null || true
}

trap cleanup INT TERM
wait
