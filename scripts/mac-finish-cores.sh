#!/usr/bin/env bash
# Start native Orpheus (llama-server + FastAPI), push Nova settings for all cores, restart agent-core.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

bash "$ROOT/scripts/mac-start-orpheus-native.sh"
bash "$ROOT/scripts/apply-nova-cores-from-memorybear.sh"
bash "$ROOT/scripts/mac-restart-nova-agent.sh"
echo "==> Done. Check http://127.0.0.1:5005/docs (Orpheus), http://127.0.0.1:8000/docs (MemoryBear), Voice page Play TTS."
echo "==> Optional: auto-restart after reboot — sudo bash scripts/install-macos-cores-watchdog.sh"
