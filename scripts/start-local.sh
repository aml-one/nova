#!/usr/bin/env bash
set -euo pipefail

echo "Starting Nova agent-core and web..."
(
  cd "$(dirname "$0")/.."
  corepack pnpm --filter @nova/agent-core dev
) &
AGENT_PID=$!

(
  cd "$(dirname "$0")/.."
  corepack pnpm --filter @nova/web dev
) &
WEB_PID=$!

echo "Started agent-core (PID $AGENT_PID) and web (PID $WEB_PID)."
wait
