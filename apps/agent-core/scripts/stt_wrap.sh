#!/bin/sh
# Invoked by agent-core as: NOVA_STT_COMMAND <absolute_path_to_audio>
# Resolves venv + stt_local.py next to this script (apps/agent-core layout).
set -e
AGENT_CORE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
# Agent / launchd jobs often have a minimal PATH; agent-core also spawns `ffmpeg` for webm→wav.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$AGENT_CORE/.venv-stt/bin/python" "$AGENT_CORE/scripts/stt_local.py" "$1"
