#!/usr/bin/env python3
"""
Local STT for agent-core: NOVA_STT_COMMAND should invoke this script with argv[1] = path to audio (WAV preferred).

Requires: pip install -r scripts/stt-requirements.txt
Optional: NOVA_STT_LOCAL_MODEL (default tiny), NOVA_STT_LOCAL_DEVICE (default cpu), NOVA_STT_LOCAL_COMPUTE (default int8).
"""
from __future__ import annotations

import os
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: stt_local.py <audio_path>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"stt_local.py: file not found: {path}", file=sys.stderr)
        sys.exit(1)
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "stt_local.py: faster-whisper not installed. Run: pip install -r scripts/stt-requirements.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    model_id = os.environ.get("NOVA_STT_LOCAL_MODEL", "tiny").strip() or "tiny"
    device = os.environ.get("NOVA_STT_LOCAL_DEVICE", "cpu").strip() or "cpu"
    compute = os.environ.get("NOVA_STT_LOCAL_COMPUTE", "int8").strip() or "int8"

    model = WhisperModel(model_id, device=device, compute_type=compute)
    segments, _info = model.transcribe(path, beam_size=5)
    parts = [s.text.strip() for s in segments]
    print(" ".join(parts).strip())


if __name__ == "__main__":
    main()
