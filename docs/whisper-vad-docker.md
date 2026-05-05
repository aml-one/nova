# Whisper + Silero VAD (Docker) for Nova STT

Nova can use any OpenAI-compatible transcription endpoint. A practical 2026 setup is a Faster-Whisper server with Silero VAD enabled.

## Example docker-compose

```yaml
services:
  whisper:
    image: hwdsl2/whisper-server:latest
    container_name: whisper-api
    ports:
      - "9000:9000"
    environment:
      - WHISPER_MODEL=large-v3-turbo
      - WHISPER_VAD_FILTER=true
      - WHISPER_LANGUAGE=en
    volumes:
      - whisper-data:/var/lib/whisper
    restart: unless-stopped

volumes:
  whisper-data:
```

## Nova agent-core env

Set these on the machine running `apps/agent-core`:

```bash
NOVA_STT_OPENAI_BASE_URL=http://127.0.0.1:9000
NOVA_STT_MODEL=whisper-1
NOVA_STT_LANGUAGE=en
NOVA_STT_TEMPERATURE=0.1
# optional domain hints:
# NOVA_STT_PROMPT=react docker typescript
```

Notes:
- `OPENAI_API_KEY` is optional for local no-auth containers.
- `NOVA_STT_COMMAND` still works and takes priority when set.
- Nova normalizes uploaded audio via ffmpeg to 16k mono WAV when available before STT.
