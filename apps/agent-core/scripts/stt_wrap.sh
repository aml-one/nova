#!/bin/sh
# Invoked by agent-core as: NOVA_STT_COMMAND <absolute_path_to_audio>
# Resolves venv + stt_local.py next to this script (apps/agent-core layout).
set -e
AGENT_CORE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec "$AGENT_CORE/.venv-stt/bin/python" "$AGENT_CORE/scripts/stt_local.py" "$1"
