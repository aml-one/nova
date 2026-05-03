# Local speech-to-text (no OpenAI)

Browser **Voice** sends audio to **agent-core** `POST /v1/voice/transcribe-audio`. Transcription runs only on the machine where agent-core runs.

You do **not** need `OPENAI_API_KEY` if you set **`NOVA_STT_COMMAND`** to a program that:

1. Receives the **absolute path to an audio file** as **the first argument** (`argv[1]` on Unix, same when invoked via Node `spawn` with one path argument).
2. Prints the **plain-text transcript to stdout** (stderr may contain logs; keep stdout clean).

## Option A: bundled Python + faster-whisper (CPU)

From the **`apps/agent-core`** directory (this is the usual cwd when you run `pnpm dev` for agent-core):

```bash
python -m venv .venv-stt
# Windows: .venv-stt\Scripts\activate
# macOS/Linux: source .venv-stt/bin/activate
pip install -r scripts/stt-requirements.txt
```

In your `.env` (repo root or wherever you load env for agent-core):

```env
NOVA_STT_COMMAND=python scripts/stt_local.py
```

On Windows, if `python` is not on PATH, try `py -3 scripts\stt_local.py` instead.

**Tuning (optional):**

- `NOVA_STT_LOCAL_MODEL` — default `tiny` (faster). Try `base` or `small` for better accuracy.
- `NOVA_STT_LOCAL_DEVICE` — default `cpu`. Use `cuda` if you have a GPU build of faster-whisper.
- `NOVA_STT_LOCAL_COMPUTE` — default `int8`. Match your install (e.g. `float16` on GPU).

## Option B: any other CLI

Point `NOVA_STT_COMMAND` at your own wrapper script or tool (whisper.cpp, etc.) as long as it follows the same argv/stdout contract.

## Why `OPENAI_API_KEY` exists

It is **optional**: when **`NOVA_STT_COMMAND` is unset** and **`OPENAI_API_KEY` is set**, agent-core calls the OpenAI-compatible **Whisper HTTP API** so you can transcribe without installing Python models. For a fully local stack, use **`NOVA_STT_COMMAND`** and leave `OPENAI_API_KEY` unset.
