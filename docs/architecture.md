# Nova Architecture

## Core Components
- `apps/agent-core`: local daemon with task orchestration, channel ingress, provider routing, memory, persona, GitOps, and self-improvement loop.
- `apps/web`: Next.js operator and chat UI (`/api/chat` proxies to agent-core local HTTP API).
- `packages/sdk`: model-provider interfaces and request/response contracts.
- `packages/skills`: reusable skill manifest/runtime contracts with permission checks.
- `skills/camera-vision`: RTSP capture + detection skill with configurable camera aliases.
- `skills/example-shell-skill`: starter skill for custom command automation.

## Platform Targets
- macOS (primary local usage)
- Windows
- Ubuntu-based Linux

## Runtime Ports
- Agent core API: `8787` (default, override with `NOVA_AGENT_PORT`)
- Web app: Next.js default `3000`

## Persistence
- Shared SQLite database at `data/state/nova.db`
- Tables:
  - `identity_map`
  - `user_profiles`
  - `short_term_turns`
  - `long_term_memory`
  - `run_history`

## Key Endpoints
- `GET /health`
- `POST /v1/chat`
- `POST /v1/webhooks/whatsapp`
- `POST /v1/webhooks/signal`
