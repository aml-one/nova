# Nova: complete installation guide (new machine)

This document is a **step-by-step** reference for installing **Nova** and **everything commonly used around it** on a **fresh computer** (macOS, Windows, or Linux). It is written so you can hand it to another person or follow it yourself months later.

**What Nova is (minimal core):** a **pnpm monorepo** with two main processes:

| Component | Role | Default URL / port |
|-----------|------|---------------------|
| **agent-core** | Model routing, memory, skills, channels, SQLite state | `http://127.0.0.1:8787` (`NOVA_AGENT_PORT`) |
| **web** | Next.js UI + API routes that proxy to agent-core | `http://localhost:3000` |

Nova stores local state in **`data/state/nova.db`** (SQLite). No separate database server is required for core Nova.

---

## Table of contents

1. [Before you start](#1-before-you-start)
2. [Minimal install (Nova only)](#2-minimal-install-nova-only)
3. [Verify the install](#3-verify-the-install)
4. [Configuration (.env and Settings UI)](#4-configuration-env-and-settings-ui)
5. [Production-style run (build + start)](#5-production-style-run-build--start)
6. [Optional: model providers](#6-optional-model-providers)
7. [Optional: support repos backup (no re-clone)](#7-optional-support-repos-backup-no-re-clone)
8. [Optional: SentiCore](#8-optional-senticore)
9. [Optional: Orpheus TTS (OpenAI-compatible `/v1/audio/speech`)](#9-optional-orpheus-tts-openai-compatible-v1audiospeech)
10. [Optional: MemoryBear](#10-optional-memorybear)
11. [Optional: other Nova-adjacent services](#11-optional-other-nova-adjacent-services)
12. [Running Nova from another device on the LAN](#12-running-nova-from-another-device-on-the-lan)
13. [Troubleshooting](#13-troubleshooting)
14. [State on disk (what to preserve)](#14-state-on-disk-what-to-preserve)
15. [Disaster recovery (new machine or dead disk)](#15-disaster-recovery-new-machine-or-dead-disk)
16. [Backup strategies: Identity backup vs local backup vs manual](#16-backup-strategies-identity-backup-vs-local-backup-vs-manual)
17. [Identity backup: design review and limits](#17-identity-backup-design-review-and-limits)
18. [macOS service + HTTPS (production-style)](#18-macos-service--https-production-style)
19. [Operational checklist after install](#19-operational-checklist-after-install)

---

## 1. Before you start

### 1.1 Hardware and OS

- **RAM:** 8 GB is enough for UI + agent-core; **16 GB+** recommended if you also run local LLMs (Ollama) or TTS (Orpheus) on the same machine.
- **Disk:** reserve at least **20 GB** for Node modules, builds, and optional models; **50 GB+** if you plan local vision/TTS/LLM models.
- **Supported OS:** macOS (Apple Silicon or Intel), Windows 10/11, Ubuntu 22.04/24.04 (and similar).

### 1.2 Accounts you may need (optional features)

- **GitHub:** clone Nova (and optional upstream repos). A [GitHub personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) is optional but recommended for `GITHUB_TOKEN` so update checks do not hit rate limits.
- **Copilot-compatible API:** if you use a cloud chat provider from Settings, you need base URL + API key (see root `README.md`).
- **WhatsApp / Signal:** only if you enable those channels (tokens and webhook secrets in `.env`).

### 1.3 What “done” looks like

- `http://localhost:8787/health` returns OK.
- `http://localhost:3000` loads the Web UI.
- You can complete **first-time login** and open **Settings** to attach providers.

### 1.4 Full dependency matrix (Nova core vs optional)

**Always required (open-source Nova stack)**

| Dependency | Version notes | Why |
|-------------|---------------|-----|
| **Git** | 2.40+ recommended | Clone repo; Identity backup uses `git push`. |
| **Node.js** | **22.x** (LTS aligned with repo tooling) | Runs agent-core (TypeScript/`tsx` or compiled `node`) and Next.js web. |
| **Corepack** | Ships with Node | Activates pinned **pnpm** (`packageManager` in root `package.json`). |
| **pnpm** | Via Corepack (`corepack pnpm …`) | Workspace install for `apps/*`, `packages/*`, `skills/*`. |
| **SQLite** | Embedded (Node `node:sqlite` / better-sqlite equiv. at runtime) | No separate database server for core product. |

**Strongly recommended**

| Dependency | When | Why |
|------------|------|-----|
| **OpenSSL** | macOS/Linux HTTPS using `scripts/start-local.sh` cert generation | Script creates `tmp/dev-cert.pem` / `tmp/dev-key.pem` when `NOVA_WEB_HTTPS=true`. |

**Optional (you only install what you enable)**

| Capability | Typical extra installs |
|-------------|-------------------------|
| Local LLM (**Ollama**) | Ollama.app / Linux package from ollama.com |
| Local OpenAI-compatible (**LM Studio**) | LM Studio + enabled local server |
| **Orpheus TTS** | Python venv or Docker per upstream Orpheus-FastAPI + inference server |
| **MemoryBear** | PostgreSQL, Neo4j, Redis, Python `uv`, Node for web (see §10) |
| **Dockerized STT** | Docker / Docker Desktop (e.g. Faster-Whisper server; see `docs/whisper-vad-docker.md`) |
| **Camera / RTSP skills** | Network paths to cameras; optional ML weights per skill |
| **Flutter mobile** | Flutter SDK (`apps/mobile_flutter`) |

---

## 2. Minimal install (Nova only)

These steps are the **canonical** path (also summarized in the repository root `README.md`).

### 2.1 Install system prerequisites

#### macOS (Homebrew typical)

1. Install **Xcode Command Line Tools** (if not already): `xcode-select --install`
2. Install **Homebrew** (if needed): see [https://brew.sh](https://brew.sh)
3. Install tools:

   ```bash
   brew install git node
   ```

4. Use **Node.js 22 LTS** (Homebrew’s `node` is usually current; for strict LTS, use `nvm` or install the official Node 22 pkg from [nodejs.org](https://nodejs.org/)).

#### Windows 10/11

1. Install **Git for Windows**: [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Install **Node.js 22 LTS** (LTS installer): [https://nodejs.org/](https://nodejs.org/)
3. Use **PowerShell** for the commands below (Windows Terminal recommended).

#### Ubuntu 22.04 / 24.04

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2.2 Enable Corepack (required for pnpm)

Nova pins the package manager in the root `package.json` (`packageManager`: `pnpm@...`). **Corepack** ships with Node and activates that pnpm version.

```bash
corepack enable
```

If `corepack` is not found, reinstall Node from the official installer or ensure your distro’s Node package includes Corepack.

### 2.3 Clone Nova

Replace the URL with **your** fork or private remote if applicable.

```bash
git clone https://github.com/aml-one/nova Nova
cd Nova
```

**Tip:** clone into a short path without spaces (e.g. `~/src/Nova`) to avoid occasional tooling issues on Windows.

### 2.4 Install JavaScript dependencies

From the repository root (where `package.json` lives):

```bash
corepack pnpm install
```

This installs all workspace packages (`apps/agent-core`, `apps/web`, `packages/*`, `skills/*`).

### 2.5 (Optional) Typecheck / tests before first run

```bash
corepack pnpm -r typecheck
corepack pnpm -r test
```

### 2.6 Start Nova (development mode)

**macOS / Linux:**

```bash
bash ./scripts/start-local.sh
```

**Windows (PowerShell):**

```powershell
powershell ./scripts/start-local.ps1
```

The script runs **agent-core** and **web** in dev mode and restarts them if one exits.

- Web UI: **http://localhost:3000**
- Agent health: **http://localhost:8787/health**

### 2.7 First-time Web UI setup

1. Open **http://localhost:3000/login** (or follow redirects from `/`).
2. Create the **admin** user when prompted (first boot).
3. Open **http://localhost:3000/settings** and configure:
   - Active provider (Ollama / LM Studio / Copilot)
   - Default models per provider
   - Optional vision, media, shell, skills, emotions, etc.

---

## 3. Verify the install

| Check | Command or URL | Expected |
|--------|-----------------|----------|
| Agent-core | Open `http://127.0.0.1:8787/health` | JSON with healthy status |
| Web | Open `http://localhost:3000` | Nova UI |
| Typecheck | `corepack pnpm -r typecheck` | Exit code 0 |
| Tests | `corepack pnpm test` | Exit code 0 (some tests may need env; see repo) |

If the Web UI says it cannot reach agent-core, confirm:

- agent-core is running and listening on **8787** (or your `NOVA_AGENT_PORT`).
- For Next.js server-side API routes, **`NOVA_AGENT_API_URL`** in the web app environment points to the same host the **server** can reach (often `http://127.0.0.1:8787`).

---

## 4. Configuration (.env and Settings UI)

### 4.1 Where files live

| Item | Location |
|------|-----------|
| Environment file | **Repository root** `.env` (same folder as `package.json`, `apps/`, `scripts/`) |
| SQLite database | `data/state/nova.db` (created at runtime); **Web UI Settings** are persisted here in table `app_settings` (not a separate JSON file). |
| Personas | `config/personas/*.persona.yaml` |
| Cameras | `config/cameras/cameras.yaml` |
| Policies | `config/improvement/policy.yaml`, `config/gitops/policy.yaml` |

### 4.2 Core `.env` variables (frequently used)

Create `.env` in the repo root. Examples (adjust to your setup):

```bash
# --- Security ---
NOVA_API_TOKEN=your-long-random-secret

# Optional: encrypt stored settings in SQLite (generate with: openssl rand -hex 32)
# NOVA_SETTINGS_SECRET=...

# --- Ports ---
# NOVA_AGENT_PORT=8787

# --- Web → agent-core (Next.js server uses this) ---
NOVA_AGENT_API_URL=http://127.0.0.1:8787

# --- GitHub API (update checks) ---
# GITHUB_TOKEN=ghp_...

# --- Copilot-compatible (if not only using Settings UI) ---
# COPILOT_BASE_URL=https://...
# COPILOT_API_KEY=...

# --- Ollama (if you use local Ollama; can also be set only in Settings) ---
# NOVA_OLLAMA_DISABLED=false
# OLLAMA_MODEL=...

# --- LM Studio ---
# NOVA_LMSTUDIO_DISABLED=false
# LMSTUDIO_MODEL=...
```

Many model and channel values can be set **only in the Web UI** after login; `.env` is for secrets, defaults, and automation.

### 4.3 Full environment reference

The root **`README.md`** contains additional sections for:

- Vision routing (`OLLAMA_VISION_*`, `LMSTUDIO_VISION_*`, `CLOUD_VISION_*`, `NOVA_VISION_PROVIDER_PRIORITY`)
- Media generation (`COMFYUI_*`, `CLOUD_IMAGE_*`, `CLOUD_VIDEO_*`, `NOVA_MEDIA_PROVIDER_PRIORITY`)
- WhatsApp / Signal delivery
- Shell isolation and skill limits
- Learning daemon tuning

Use that file as the **authoritative list** of every supported variable.

---

## 5. Production-style run (build + start)

For a machine where you do not want `tsx watch` / `next dev`:

```bash
corepack pnpm -r build
```

Then start processes separately (example):

```bash
# Terminal 1
corepack pnpm --filter @nova/agent-core start

# Terminal 2
corepack pnpm --filter @nova/web start
```

**OS-level autostart:** use the templates in this repo:

- **macOS:** `deploy/launchd/*.plist` (see root `README.md`)
- **Windows:** `deploy/windows/install-startup-tasks.ps1`
- **Linux:** `deploy/systemd/*.service` (see root `README.md`)

Ensure log directories exist (e.g. `mkdir -p data/logs`) if your unit files write logs there.

---

## 6. Optional: model providers

Nova does **not** require all of these; pick what you use.

| Provider | Install on the host | Nova configuration |
|----------|---------------------|---------------------|
| **Ollama** | [https://ollama.com](https://ollama.com) | Settings → enable Ollama; set default model; or env vars |
| **LM Studio** | [https://lmstudio.ai](https://lmstudio.ai) | Start local server; Settings → LM Studio |
| **Copilot-compatible** | None (HTTP API) | Settings → Copilot base URL + API key |

**Pull models** (Ollama example):

```bash
ollama pull llama3.2
```

Use whatever model fits your hardware and policy; Nova routes using **Settings**, not a hard-coded model name.

---

## 7. Optional: support repos backup (no re-clone)

If you integrate **SentiCore**, **Orpheus-FastAPI**, **MemoryBear**, or other upstream projects, keep a **local mirror** so a new machine does not depend on GitHub availability or rate limits.

### 7.1 One-time: clone into a dedicated folder

Example layout:

```text
~/nova-support/
  SentiCore/
  Orpheus-FastAPI/
  MemoryBear/
```

```bash
mkdir -p ~/nova-support && cd ~/nova-support
git clone --depth 1 https://github.com/chuchuyei/SentiCore.git
git clone --depth 1 https://github.com/Lex-au/Orpheus-FastAPI.git
git clone --depth 1 https://github.com/SuanmoSuanyangTechnology/MemoryBear.git
```

`--depth 1` keeps disk use smaller; remove it if you want full history.

### 7.2 Backup without Git (tarball)

From the parent directory:

```bash
cd ~
tar -czvf nova-support-repos-$(date +%Y%m%d).tar.gz nova-support
```

Copy the `.tar.gz` to external storage or another PC. Restore:

```bash
tar -xzvf nova-support-repos-YYYYMMDD.tar.gz -C ~
```

### 7.3 Bare mirror (Git advanced)

For incremental updates and tiny transfers:

```bash
git clone --mirror https://github.com/chuchuyei/SentiCore.git SentiCore.git
# Later on a new machine:
git clone SentiCore.git SentiCore
```

Repeat per repository.

---

## 8. Optional: SentiCore

**Upstream:** [https://github.com/chuchuyei/SentiCore](https://github.com/chuchuyei/SentiCore)

SentiCore is primarily **documentation and prompts** (orchestration + emotion skill) plus optional **shell installers** for specific agent hosts (e.g. OpenClaw / Hermes). Nova may consume the markdown as **knowledge** or **system prompt** material rather than running SentiCore’s installers verbatim.

**Install steps (generic):**

1. Keep a clone under `~/nova-support/SentiCore` (see [§7](#7-optional-support-repos-backup-no-re-clone)).
2. Read `README.md` in that repo for the **three-step** quick start (orchestration prompt, emotion skill, optional `soul.md`).
3. If you use Nova’s built-in emotion pipeline, align Nova Settings → **Emotion Core** with your chosen SentiCore workflow (project-specific).

No separate compiler or database is required for SentiCore **as prompt files**.

---

## 9. Optional: Orpheus TTS (OpenAI-compatible `/v1/audio/speech`)

**Upstream:** [https://github.com/Lex-au/Orpheus-FastAPI](https://github.com/Lex-au/Orpheus-FastAPI)

Orpheus-FastAPI provides a **local TTS HTTP server** (commonly port **5005**) with an **OpenAI-compatible** endpoint:

- `POST /v1/audio/speech` with JSON body (`input`, `voice`, `response_format`, etc.)

**Important:** Orpheus-FastAPI expects a **separate inference server** running the Orpheus **GGUF** model (llama.cpp, LM Studio, GPUStack, etc.). Read the upstream README for `ORPHEUS_API_URL` and hardware (CUDA / ROCm / CPU).

**Suggested install (native, Python 3.11):**

Upstream notes **Python 3.8–3.11** for some paths (check current README for changes).

```bash
cd ~/nova-support/Orpheus-FastAPI
/opt/homebrew/bin/python3.11 -m venv .venv   # macOS Homebrew example path
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
cp .env.example .env   # if present; then edit ORPHEUS_API_URL and ports
python app.py        # or uvicorn as per upstream
```

**Docker:** upstream provides `docker-compose` variants (GPU / CPU).

**Nova integration (conceptual):** point Nova’s TTS client (or Web UI) at `http://<host>:5005/v1/audio/speech`. Chat **models** still come from Nova **Settings** (Ollama / LM Studio / Copilot), not from Orpheus.

---

## 10. Optional: MemoryBear

**Upstream:** [https://github.com/SuanmoSuanyangTechnology/MemoryBear](https://github.com/SuanmoSuanyangTechnology/MemoryBear)

MemoryBear is a **separate product**: FastAPI backend, web frontend, **PostgreSQL**, **Neo4j**, **Redis**, and often **Celery** workers. It is **not** required to run Nova’s default SQLite memory.

**Official prerequisites (typical):**

- Node.js **20.19+** or **22.12+** (web)
- Python **3.12** (API)
- PostgreSQL **13+**
- Neo4j **4.4+**
- Redis **6+**
- **uv** for Python deps (`pip install uv`)

**API install (abbreviated):**

```bash
cd ~/nova-support/MemoryBear/api
cp env.example .env
# Edit .env: NEO4J_*, DB_*, REDIS_*, SECRET_KEY, etc.

uv sync
# Configure alembic.ini / DATABASE_URL per upstream docs, then:
alembic upgrade head
uv run -m app.main
```

**Frontend (abbreviated):**

```bash
cd ~/nova-support/MemoryBear/web
npm install
npm run dev
```

**First-time admin:** upstream README describes calling `POST /api/setup` and default credentials—**change them immediately** in any real deployment.

**Nova integration:** agent-core calls MemoryBear’s **sync** service API (`/v1/memory/read/sync`, `/v1/memory/write/sync`, `/v1/end_user/create`) when MemoryBear is enabled. In the **Web UI → Settings → Learning**, turn on MemoryBear, set **base URL** (for example `http://127.0.0.1:8000`), and paste the **API key** (service scope `memory`). Alternatively, set env on the **agent-core** process: `NOVA_MEMORYBEAR_ENABLED=true`, `NOVA_MEMORYBEAR_BASE_URL`, `NOVA_MEMORYBEAR_API_KEY`, and optionally `NOVA_MEMORYBEAR_SEARCH_SWITCH` (`0`|`1`|`2`), `NOVA_MEMORYBEAR_STORAGE_TYPE` (`neo4j`|`rag`), `NOVA_MEMORYBEAR_SYNC_WRITES=true`.

**macOS + Homebrew (Postgres, Redis, Neo4j—no Docker for Neo4j):** from a clone of this Nova repo on the Mac, install upstream deps (`brew install postgresql@16 redis neo4j`, Python `uv`, MemoryBear under `~/nova-deps/MemoryBear` or override `MB_DIR`), then run:

```bash
cd /path/to/Nova
MB_PASSWORD='your-secret' bash scripts/memorybear-mac-bootstrap.sh
```

The script starts the three brew services, writes MemoryBear `api/.env`, runs Alembic, starts the API on port **8000**, completes setup/login, creates a Nova API key, and writes it to **`$HOME/nova-deps/memorybear-nova-api-key.txt`** by default (`MB_PASSWORD` defaults to a documented dev value in the script header—override in production).

**Troubleshooting (macOS):**

- **`nova-es` / Elasticsearch:** MemoryBear’s generated `.env` uses **`ELASTICSEARCH_PORT=9201`** (avoids Docker hogging **9200**). If the API logs ES errors or `nova-es` shows **`Exited`**, re-run **`bash scripts/memorybear-es-docker.sh`** from the Nova repo (or re-run the bootstrap ES block). After **Docker Desktop restart**, start **`nova-es`** again if MemoryBear needs RAG/ES.
- **Nova sync returns 500 / “embedding model is required”:** that comes from **MemoryBear workspace memory config**, not Nova. In the **MemoryBear** web UI, open the workspace’s memory / model settings and assign an **embedding model** (per upstream MemoryBear docs) so `/v1/memory/read/sync` can load the config.
- **Web login / `npm run dev` → `ECONNREFUSED` on port 5173 when calling `/api/token`:** upstream `web/vite.config.ts` may still proxy **`/api` → `http://localhost:5173`** (nothing listens there). The API lives on **:8000**. From your Nova repo on the Mac run **`bash scripts/patch-memorybear-web-vite-proxy.sh`** (or edit **`vite.config.ts`** so the `/api` proxy **`target`** is **`http://127.0.0.1:8000`**), restart **`npm run dev`**, and ensure the **FastAPI** process is running on **8000**.
- **Rerank / `PROVIDER_NOT_SUPPORTED` (ollama or openai for rerank):** upstream MemoryBear only implements rerank for **`xinference`**, **`gpustack`**, and **`dashscope`**. On macOS, start Xinference in Docker from this repo: **`bash scripts/xinference-mac-docker.sh`** (defaults to **`http://127.0.0.1:9997`**). Then launch a rerank model in the Xinference UI and register it in MemoryBear with provider **`xinference`** and that base URL.

---

## 11. Optional: other Nova-adjacent services

| Feature | Extra dependency |
|---------|------------------|
| **RTSP / camera vision** | Network path to cameras; optional plate recognition models per skill |
| **ComfyUI media** | Running ComfyUI instance + workflow JSON in env |
| **Perplexica / web search skills** | Upstream stack per skill README |
| **Docker-based skills** | Docker Engine / Colima / Docker Desktop |
| **Flutter mobile companion** | Flutter SDK + platform toolchains (see `docs/mobile-setup.md` if present) |

Read each skill’s folder under `skills/<name>/` for exact requirements.

---

## 12. Running Nova from another device on the LAN

By default, agent-core binds to the configured port for local use. To use the Web UI from a **phone or second PC**:

1. Run agent-core and web bound to `0.0.0.0` or use a reverse proxy (nginx, Caddy) with TLS.
2. Set **`NOVA_AGENT_API_URL`** for the **web** process to a URL the **Next.js server** can reach (not the browser’s localhost if web runs on a headless server).
3. Set **`NOVA_API_TOKEN`** and matching **Authorization** from the web app if you secure agent-core.
4. Open firewall ports **3000** (web) and **8787** (agent-core) only on trusted networks, or prefer VPN / SSH tunnel.

---

## 13. Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| `corepack: command not found` | Node install incomplete; reinstall Node 22+ from official package. |
| `pnpm` version mismatch | Run `corepack enable` again; delete `node_modules` and lockfile only if you know what you are doing—usually not needed. |
| Web UI cannot reach agent | `NOVA_AGENT_API_URL`, firewall, agent-core logs, port conflict on 8787. |
| SQLite locked / corrupt | Stop all instances writing `data/state/nova.db`; restore from backup. |
| Ollama never routes | Settings may have Ollama disabled; or `NOVA_OLLAMA_DISABLED=false` vs env defaults—check root `README.md`. |
| Windows path issues | Prefer short paths; run PowerShell as normal user with execution policy allowing scripts for `start-local.ps1`. |
| Out of disk during `pnpm install` | Clear old `node_modules`; use `pnpm store prune`. |

**Logs:** run each service in its own terminal first to see stack traces before daemonizing.

---

## 14. State on disk (what to preserve)

Everything below is **relative to the Nova repository root** (the folder that contains `package.json`, `apps/`, `data/`, `config/`).

### 14.1 Authoritative stores

| Area | Location | What it holds |
|------|-----------|----------------|
| **Primary database** | `data/state/nova.db` | Conversation/run history, SQLite memory tables, **Web UI Settings** (`app_settings` row: models, channels, MemoryBear, backups schedule, chat UI prefs, encrypted secrets if `NOVA_SETTINGS_SECRET` is set), auth users/sessions (if used), emotion state/events, improvement learning log metadata, **improvement proposals queue**, update events, schedules, and most product state. |
| **Learning log (JSON mirror)** | `data/state/learning-log.json` | Append-only style learning timeline used by the self-improvement UI; safe to back up alongside the DB. |
| **Curiosity store** | `data/state/curiosity-store.json` | Idle-learning / curiosity counters and queued follow-up questions. |
| **Install / update clock** | `data/state/install-meta.json` | `installedAt` timestamp used by the in-app update checker. |
| **Repository config** | `config/**` | Default persona YAML, camera map, improvement + gitops policy. Custom `SOUL.md` or extra YAML you add here should live under `config/` or paths you configure (e.g. SentiCore markdown path). |
| **Environment secrets** | **`.env` in repo root** | API tokens, optional `GITHUB_TOKEN`, `NOVA_API_TOKEN`, provider keys when not only in Settings. **Not** stored in git; you must copy this file yourself to a new machine or password manager. |
| **Runtime TLS (dev)** | `tmp/dev-cert.pem`, `tmp/dev-key.pem` (defaults) | Self-signed certs when `NOVA_WEB_HTTPS=true`; regeneratable. |
| **Uploads / media** | `data/uploads/` (and related metadata in DB) | User-uploaded images/files referenced from chat; back up if you care about historical attachments. |

### 14.2 What you do **not** need for a minimal “Nova works again” restore

- `node_modules/` (recreated with `corepack pnpm install`)
- `apps/web/.next/` (recreated with build or dev)
- `apps/agent-core/dist/` (recreated with `pnpm --filter @nova/agent-core build`)

---

## 15. Disaster recovery (new machine or dead disk)

High-level flow:

1. **Install OS prerequisites** (Git, Node 22+, OpenSSL if you use HTTPS script paths on macOS/Linux).
2. **Clone Nova** to the same relative layout you prefer (short path, no spaces on Windows).
3. **`corepack enable`** then **`corepack pnpm install`** at repo root.
4. **Restore state** (pick one path under [§16](#16-backup-strategies-identity-backup-vs-local-backup-vs-manual)):
   - Copy a saved `nova.db` + `config/` + optional JSON sidecars into `data/state/` and `config/`, **or**
   - Use `POST /v1/restore` with a folder created by `POST /v1/backup`, **or**
   - Merge a snapshot from an `identity-backup/*` Git branch into `data/` and `config/`.
5. **Restore `.env`** from your secret store (or recreate keys and re-enter credentials in Settings).
6. **Start Nova** (`scripts/start-local.sh` / `.ps1` or your launchd/systemd/Task Scheduler units).
7. **Verify**: `GET /health` on agent-core, open Web UI, log in, send a test message, run **Settings → Updates → Check** if you use GitHub updates.

**SQLite consistency:** Copying `nova.db` while the agent is writing is usually fine for home use, but for paranoia stop agent-core first or use SQLite’s online backup API. If you see corruption, restore an older snapshot.

---

## 16. Backup strategies: Identity backup vs local backup vs manual

| Mechanism | API / UI | What it captures | Where it goes | Best for |
|-----------|----------|------------------|---------------|----------|
| **Identity backup (push)** | `POST /v1/backup/identity/push` (Web UI: Settings → backup / Identity) | `nova.db`, `config/**`, `learning-log.json`, `curiosity-store.json`, `install-meta.json`, plus `manifest.json` and a short `README-SNAPSHOT.txt` inside the snapshot | New **git branch** `identity-backup/<timestamp>` pushed to **origin** | Off-site, versioned snapshots tied to Git history |
| **Local backup folder** | `POST /v1/backup` | `nova.db`, whole `config/`, **`skills/`** tree, and the same JSON sidecars as above | `data/backups/backup-<timestamp>/` on local disk | Quick clone before risky experiment; includes custom skills |
| **Restore** | `POST /v1/restore` `{ "backupPath": "…" }` | Reverses **local** backup layout into repo | N/A | Restore from `data/backups/...` |
| **Manual** | Copy files / tarball | You choose | USB, NAS, encrypted archive | Air-gapped or no Git remote |

**Settings:** Web UI settings are stored **inside `nova.db`** (table `app_settings`). They are **already included** in both Identity backup and local backup as long as `nova.db` is copied. There is no separate “settings-only” file unless you export JSON yourself from the DB.

**`.env`:** Still **your** responsibility — copy it to a vault or encrypt a tarball; do not push it to a public repo.

---

## 17. Identity backup: design review and limits

### 17.1 What it does well

- **Single-click / scheduled** push of a **manifested** snapshot (hash per file) for audit and drift detection.
- Captures **persona + policy + database**, i.e. the core of “who Nova is” and “what she remembers” in one operation.
- **Includes Web UI settings** via `nova.db` (models, channel access, MemoryBear keys, Orpheus URL, identity backup schedule itself, etc.).

### 17.2 Gaps and risks (be aware)

1. **Secrets on Git branches:** `nova.db` may contain API keys and tokens (plain or `enc:v1:` blobs). **Private GitHub repo + branch protection** is strongly recommended. If the repo is public, do not use Identity push, or scrub keys from Settings before pushing.
2. **No `.env`:** Environment defaults and bootstrap secrets are **not** in the snapshot; keep `.env` elsewhere.
3. **No `skills/` tree:** Custom skill code under `skills/` is **not** in Identity backup (it is in **local** `POST /v1/backup`). Re-clone the repo or back up `skills/` separately if you fork skills.
4. **No `data/uploads/`:** Large media is excluded by design; archive separately if needed.
5. **Git required on the host:** Push uses `git commit` + `git push`; the machine must have `git` configured with credentials for `origin` (SSH key or helper).
6. **Cross-user / launchd:** If a system daemon runs `git` as root against a user-owned repo, Git may refuse with “dubious ownership” — Nova’s updater sets a safe directory for pulls; for manual `git` on the Mac, see `docs/macos-service.md`.

### 17.3 Practical recommendation

- Use **Identity backup** for **encrypted private remote** + periodic disaster recovery drills.
- Use **local `POST /v1/backup`** before upgrades or persona experiments.
- Keep **password manager / encrypted copy of `.env`** and a **tarball of `skills/`** if you customize skills.

---

## 18. macOS service + HTTPS (production-style)

For a Mac that should survive reboots and support **Apply latest** from the Web UI without manual SSH:

- Follow **[docs/macos-service.md](./macos-service.md)** (`com.nova.localstack`, HTTPS via env in `scripts/start-local-macos-service.sh`).
- Ensure **`GITHUB_TOKEN`** (or equivalent) is available to the agent process if update checks hit GitHub API rate limits.
- After restoring from backup on a **new** Mac, re-run the installer once so `launchd` points at the new path if your home directory layout changed.

Also see **root `README.md`** for alternative **LaunchAgent** templates under `deploy/launchd/` (user session, different from the system daemon approach).

---

## 19. Operational checklist after install

- [ ] `corepack pnpm install` completes without errors.
- [ ] `http://127.0.0.1:8787/health` (or your `NOVA_AGENT_PORT`) returns OK.
- [ ] Web UI loads; first admin user created at `/login` if auth is enabled.
- [ ] **Settings** saved (provider, models) — confirm they survive an agent-core restart (proves SQLite write path works).
- [ ] **Backup:** run one **local** backup (`POST /v1/backup`) and confirm folder under `data/backups/`.
- [ ] **Optional:** configure **Identity backup** to a **private** remote; trigger manual push once and verify branch on GitHub.
- [ ] **`.env`:** stored in a password manager or encrypted backup; not committed.
- [ ] **Updates:** `GITHUB_TOKEN` set if you use GitHub-based update checks; test **Apply latest** on a non-production clone first.

---

## Quick checklist (copy/paste)

**Nova core**

- [ ] Git + Node 22 + `corepack enable`
- [ ] `git clone` Nova → `cd Nova`
- [ ] `corepack pnpm install`
- [ ] (Optional) `corepack pnpm -r typecheck` / `test`
- [ ] `bash ./scripts/start-local.sh` or Windows `start-local.ps1`
- [ ] `/health` + `/` + `/login` + `/settings`

**Optional backups**

- [ ] `~/nova-support/` clones: SentiCore, Orpheus-FastAPI, MemoryBear
- [ ] `tar -czvf` archive of `nova-support` dated and stored off-machine

**Optional services**

- [ ] Ollama and/or LM Studio and/or Copilot credentials
- [ ] Orpheus inference + Orpheus-FastAPI + Nova TTS wiring
- [ ] MemoryBear stack + API keys + Nova memory client wiring

---

## Document history

- **Purpose:** single thorough guide for installing Nova and common dependencies on **another computer**, including **offline-friendly** upstream repo retention, **disaster recovery**, and **backup/restore** semantics (Identity backup vs local backup, settings location, secrets).
- **Canonical Nova quick start:** still the repository root **`README.md`**; this guide expands operational detail and optional stacks.

When Nova’s upstream install steps change, update **this file** and the root **README** in the same pull request so they stay aligned.
