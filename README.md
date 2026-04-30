# Nova Agent Platform

Local-first headless AI agent framework for macOS, Windows, and Ubuntu.

## Features
- Multi-provider routing: Ollama, LM Studio, Copilot-compatible endpoint.
- Provider circuit breaker + health-based weighted failover.
- Autonomous shell execution with policy guardrails and audit logging.
- Human-in-the-loop approval flow for risky commands.
- Multi-channel ingress: web chat, WhatsApp webhook parser, Signal webhook parser.
- Signed webhook verification and API token auth support.
- Outbound queue with exponential retry and dead-letter handling.
- Phone-number identity resolution + per-user memory and persona overrides.
- SQLite migrations with schema versioning (`PRAGMA user_version`).
- Extensible skill runtime and RTSP camera vision skill.
- Optional isolated skill execution (process timeout/memory cap).
- Controlled self-improvement loop and Git-based checkpoint/rollback hooks.
- Voice I/O, scheduler, multi-agent mode, RAG indexing/query, dashboard APIs, camera timeline search.
- One-click backup/restore and persona version rollback APIs.
- WebUI admin login (email/password), session auth, and settings page.
- Delegated multi-folder access control for autonomous shell commands.
- Full settings controls for provider routing, shell limits, and skill runtime isolation.
- Full health dashboard with channel/webhook status and restart controls.
- Health checks include masked secret fingerprints and last-success timestamps.
- Multi-user WebUI auth with per-user sessions and optional login bypass mode.
- Idle-time background self-learning daemon with internet research.
- Dedicated learning timeline page (`/learning`) grouped by date.
- Network defense skill for host traffic anomaly detection and guarded firewall actions.
- Security Center page (`/security`) with live anomalies, one-click actions, and audit trail.
- Phone-number role access control for WhatsApp/Signal with silent deny for unknown numbers.
- Access simulator in Settings for testing phone-role outcomes before rollout.
- Emotional personality core (valence/arousal heuristic overlay with configurable expression style).
- Security Center includes role policy tester with human-readable block/allow explanations.
- Emotion state now reacts to both user interactions and self-improvement outcomes.

## Quick Start
1. Install dependencies:
   - `corepack pnpm install`
2. Run both services:
   - Windows: `powershell ./scripts/start-local.ps1`
   - macOS/Ubuntu: `bash ./scripts/start-local.sh`
3. Open web UI:
   - `http://localhost:3000`
4. Open dashboard:
   - `http://localhost:3000/dashboard`
5. Configure credentials/settings:
   - `http://localhost:3000/login`
   - `http://localhost:3000/settings`

## Installation Guide

### Prerequisites (all platforms)
- Git 2.40+
- Node.js 22 LTS (recommended)
- Corepack enabled (`corepack enable`)
- `pnpm` via Corepack (no global install required)

### macOS (Apple Silicon + Intel)
1. Install required tools (Homebrew):
   - `brew install git node`
2. Clone repository:
   - `git clone <your-repo-url> Nova`
   - `cd Nova`
3. Enable Corepack:
   - `corepack enable`
4. Install workspace dependencies:
   - `corepack pnpm install`
5. (Optional) Create `.env` values for provider/channel credentials.
6. Start the full local stack:
   - `bash ./scripts/start-local.sh`
7. Open UI:
   - `http://localhost:3000`
8. First-time setup:
   - create admin user at `/login`
   - configure models/channels at `/settings`

### Windows 10/11 (PowerShell)
1. Install required tools:
   - Git for Windows
   - Node.js 22 LTS
2. Open **PowerShell** and clone:
   - `git clone <your-repo-url> Nova`
   - `cd Nova`
3. Enable Corepack:
   - `corepack enable`
4. Install dependencies:
   - `corepack pnpm install`
5. (Optional) Configure `.env` credentials for models/channels.
6. Start services:
   - `powershell ./scripts/start-local.ps1`
7. Open UI:
   - `http://localhost:3000`
8. Complete login/settings setup in WebUI.

### Ubuntu (22.04/24.04)
1. Install prerequisites:
   - `sudo apt update`
   - `sudo apt install -y git curl ca-certificates`
2. Install Node.js 22 (NodeSource):
   - `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -`
   - `sudo apt install -y nodejs`
3. Clone project:
   - `git clone <your-repo-url> Nova`
   - `cd Nova`
4. Enable Corepack + install deps:
   - `corepack enable`
   - `corepack pnpm install`
5. (Optional) Configure `.env` credentials.
6. Start local stack:
   - `bash ./scripts/start-local.sh`
7. Open UI:
   - `http://localhost:3000`

### Verify installation
- Backend health:
  - `http://localhost:8787/health`
- Web UI:
  - `http://localhost:3000`
- If checks fail:
  - run `corepack pnpm -r typecheck`
  - run `corepack pnpm -r test`

### Start Nova at system boot

Recommended production approach: run Nova as OS services (agent-core + web) and let the OS restart them automatically.

#### macOS (`launchd`)
1. Build once:
   - `corepack pnpm -r build`
2. Prepare logs dir:
   - `mkdir -p data/logs`
3. Copy templates:
   - `cp deploy/launchd/com.aml.nova.agent-core.plist ~/Library/LaunchAgents/`
   - `cp deploy/launchd/com.aml.nova.web.plist ~/Library/LaunchAgents/`
4. Replace `__NOVA_PATH__` in both plist files with your absolute Nova path.
5. Load and start:
   - `launchctl unload ~/Library/LaunchAgents/com.aml.nova.agent-core.plist 2>/dev/null || true`
   - `launchctl unload ~/Library/LaunchAgents/com.aml.nova.web.plist 2>/dev/null || true`
   - `launchctl load ~/Library/LaunchAgents/com.aml.nova.agent-core.plist`
   - `launchctl load ~/Library/LaunchAgents/com.aml.nova.web.plist`
6. Verify:
   - `launchctl list | rg "com.aml.nova"`

#### Windows (Task Scheduler)
1. Build once:
   - `corepack pnpm -r build`
2. Open elevated PowerShell and install startup tasks from template:
   - `powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-startup-tasks.ps1`
3. Verify tasks:
   - `Get-ScheduledTask -TaskName "Nova Agent Core","Nova Web UI"`
4. Test run once:
   - `Start-ScheduledTask -TaskName "Nova Agent Core"`
   - `Start-ScheduledTask -TaskName "Nova Web UI"`

#### Ubuntu (systemd)
1. Build once:
   - `corepack pnpm -r build`
2. Copy service templates:
   - `sudo cp deploy/systemd/nova-agent-core.service /etc/systemd/system/`
   - `sudo cp deploy/systemd/nova-web.service /etc/systemd/system/`
3. Edit placeholders:
   - replace `__NOVA_PATH__` with your absolute Nova path
   - replace `__USER__` with your Linux user
4. Enable and start:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable nova-agent-core.service nova-web.service`
   - `sudo systemctl start nova-agent-core.service nova-web.service`
5. Verify:
   - `systemctl status nova-agent-core.service`
   - `systemctl status nova-web.service`

## Configuration
- Persona files: `config/personas/*.persona.yaml`
- Camera aliases and RTSP mapping: `config/cameras/cameras.yaml`
- Improvement policy: `config/improvement/policy.yaml`
- GitOps policy: `config/gitops/policy.yaml`
- SQLite state DB: `data/state/nova.db`

### Messaging Delivery Environment
- WhatsApp outbound:
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_TOKEN`
  - Optional `WHATSAPP_API_BASE_URL` for integration tests
  - Optional `WHATSAPP_APP_SECRET` for signature verification
- Signal outbound (`signal-cli-rest-api` compatible):
  - `SIGNAL_API_URL`
  - `SIGNAL_ACCOUNT_NUMBER`
  - Optional `SIGNAL_WEBHOOK_SECRET` for signature verification

### Core Security/Runtime Environment
- `NOVA_API_TOKEN` for protected local API access
- `NOVA_SHELL_CONTAINER_COMMAND` to wrap shell commands in container runtime
- `NOVA_REQUIRE_APPROVALS=true` to enforce approval flow
- `NOVA_SKILL_ISOLATION=true`, `NOVA_SKILL_TIMEOUT_MS`, `NOVA_SKILL_MAX_MB`
- Delegated folder access can now be managed in WebUI Settings (`/settings`)

### Automatic Vision Routing
- Chat model stays primary; vision model is used automatically for image/camera requests.
- Local LM Studio vision:
  - `LMSTUDIO_VISION_BASE_URL`
  - `LMSTUDIO_VISION_MODEL`
- Local Ollama vision:
  - `OLLAMA_VISION_BASE_URL`
  - `OLLAMA_VISION_MODEL` (example: `llava`)
- Cloud vision:
  - `CLOUD_VISION_BASE_URL`
  - `CLOUD_VISION_MODEL`
  - `CLOUD_VISION_API_KEY`
- Optional provider order:
  - `NOVA_VISION_PROVIDER_PRIORITY=lmstudio,ollama,cloud`

### Automatic Media Generation Routing
- Generation requests in chat are auto-routed when user asks to generate image/video.
- Provider order:
  - `NOVA_MEDIA_PROVIDER_PRIORITY=comfyui,cloud`
- ComfyUI (local or remote URL):
  - `COMFYUI_BASE_URL`
  - `COMFYUI_WORKFLOW_JSON` (for image generation via `/prompt`)
  - optional `COMFYUI_VIDEO_ENDPOINT` (custom video route)
- Cloud image generation:
  - `CLOUD_IMAGE_API_URL`
  - `CLOUD_IMAGE_API_KEY`
  - optional `CLOUD_IMAGE_MODEL`
- Cloud video generation:
  - `CLOUD_VIDEO_API_URL`
  - `CLOUD_VIDEO_API_KEY`

## Key API Endpoints
- `POST /v1/chat`
- `POST /v1/media/upload`
- `GET /v1/media/files/:name`
- `GET /v1/history`
- `POST /v1/voice/transcribe`
- `POST /v1/voice/speak`
- `POST /v1/rag/index`
- `POST /v1/rag/query`
- `POST /v1/schedule`
- `GET /v1/camera/timeline`
- `GET /v1/approvals`, `POST /v1/approvals/approve`
- `GET /v1/personas/versions`, `POST /v1/personas/rollback`
- `POST /v1/backup`, `POST /v1/restore`
- `GET /v1/auth/state`, `POST /v1/auth/setup`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/auth/me`
- `GET /v1/auth/users`, `POST /v1/auth/users`
- `GET /v1/settings`, `PUT /v1/settings`
- `GET /v1/system/health/full`, `POST /v1/system/restart`
- `GET /v1/improvement/history`, `POST /v1/improvement/cycle`
- `GET /v1/security/analyze`, `POST /v1/security/action`, `GET /v1/security/history`
- `POST /v1/access/simulate`
- `GET /v1/emotion/state`

### Background Learning Controls
- `config/improvement/policy.yaml`
  - `backgroundLearningEnabled`
  - `minFailureCountForAutoImprove`
- Optional runtime tuning:
  - `NOVA_LEARNING_IDLE_MINUTES` (default `3`)
  - `NOVA_LEARNING_INTERVAL_MS` (default `120000`)

### Channel Access Control
- Configure in Settings -> **Channel Phone Access Control**
- Roles:
  - **Sys Admin**: full control
  - **Guest**: chat + image/video generation; no camera/shell/scheduler/security center
  - **Important Person**: custom elevated permissions per phone
- Unknown numbers can be set to **silent deny** (no response at all).

### Emotion Core Controls
- Configure in Settings -> **Emotion Core**
- Options:
  - enable/disable emotional heuristic overlay
  - expression style (`subtle` / `balanced` / `expressive`)
  - mirror user valence for empathy

### Network Defense Skill
- Skill ID: `network-defense`
- Modes:
  - `monitor` / `detect` (snapshot + anomaly analysis)
  - `block_ip` (guarded block command generation/apply)
  - `harden` (guarded closure of risky listening ports)
- Dangerous changes require:
  - `apply: true`
  - `confirmation: "I_ACKNOWLEDGE_NETWORK_CHANGES"`

## Tests
- Run all tests: `corepack pnpm test`
- Run type checks: `corepack pnpm typecheck`
