#!/usr/bin/env bash
# Upstream MemoryBear web/vite.config.ts may proxy /api to port 5173 (wrong). Use the API on :8000.
# Usage: bash scripts/patch-memorybear-web-vite-proxy.sh [path/to/MemoryBear/web]
# Env: MEMORYBEAR_API_PROXY=http://127.0.0.1:8000 (default)
set -euo pipefail
MB_WEB="${1:-${HOME}/nova-deps/MemoryBear/web}"
CFG="${MB_WEB}/vite.config.ts"
export MEMORYBEAR_API_PROXY="${MEMORYBEAR_API_PROXY:-http://127.0.0.1:8000}"
if [[ ! -f "${CFG}" ]]; then
  echo "ERROR: ${CFG} not found" >&2
  exit 1
fi
export MB_WEB_CFG="${CFG}"
python3 <<'PY'
import os
from pathlib import Path

api = os.environ.get("MEMORYBEAR_API_PROXY", "http://127.0.0.1:8000")
cfg = Path(os.environ["MB_WEB_CFG"])
text = cfg.read_text(encoding="utf-8")
orig = text
pairs = [
    ("target: 'http://localhost:5173'", f"target: '{api}'"),
    ('target: "http://localhost:5173"', f'target: "{api}"'),
    ("target: 'http://127.0.0.1:5173'", f"target: '{api}'"),
    ('target: "http://127.0.0.1:5173"', f'target: "{api}"'),
]
for old, new in pairs:
    text = text.replace(old, new)
if text == orig:
    print("No 5173 API proxy target found; edit manually:", cfg)
else:
    cfg.write_text(text, encoding="utf-8")
    print("Updated", cfg, "→", api)
PY
