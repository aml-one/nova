# Cursor agent onboarding — Nova

Read this at the start of a session when you need to operate, debug, or deploy **Nova** (the local-first agent platform in this repo). It is the operational “big picture”; deep install steps live in [install-nova-complete-guide.md](./install-nova-complete-guide.md) and the root [README.md](../README.md).

---

## What Nova is (architecture)

| Piece | Role | Typical dev URL |
|--------|------|------------------|
| **agent-core** | Node HTTP API: chat, auth, settings, webhooks (Signal/WhatsApp), SQLite state, outbound queue | `http://127.0.0.1:8787` |
| **WebUI** | Next.js app; proxies to agent-core via server routes (`x-session-token` cookie → `NOVA_AGENT_API_URL`) | `http://localhost:3000` or HTTPS on 443 in service mode |
| **State** | SQLite: `apps/agent-core/data/state/nova.db` (path relative to agent-core cwd) | — |

- **Auth**: WebUI users in `app_users` / `app_sessions`; `POST /v1/chat` uses session when logged in.
- **Channels**: Signal / WhatsApp ingress → `TaskOrchestrator` → outbound queue / dispatcher.
- **Per-person features** (people, relationships, admin People UI) use the same DB; WebUI People is under **`/admin/people`**.

---

## Repo layout (where to look)

```
apps/agent-core/     # HTTP server, orchestrator, channels, SQLite migrations
apps/web/             # Next.js WebUI
scripts/start-local.sh          # Starts agent-core + web (dev-style)
scripts/start-local-macos-service.sh   # Wrapper for macOS LaunchDaemon (HTTPS, standard ports)
scripts/install-macos-service.sh     # Installs root LaunchDaemon (needs sudo)
config/               # Personas YAML, etc.
docs/                 # Long guides + this file
```

---

## Local development (any machine)

From repo root:

1. `corepack enable` (once)
2. `corepack pnpm install`
3. **Start**: `bash ./scripts/start-local.sh` (macOS/Linux) or `powershell ./scripts/start-local.ps1` (Windows)
4. **WebUI**: `http://localhost:3000` — **agent-core health**: `http://localhost:8787/health`
5. Optional **`.env`** at repo root — `start-local.sh` sources it so agent-core and web see secrets (`launchd` does not load shell profiles; **service install relies on this file**).

---

## Production-style setup on macOS (service)

This is the common “Nova Mac server” pattern (example path: `~/projects/Nova`; adjust user/host as needed).

### Install / service identity

- **LaunchDaemon label**: `com.nova.localstack`
- **WebRTC voice gateway** (Python, mobile/WebRTC bridge): LaunchDaemon label `com.nova.voice-gateway` — HTTP `http://127.0.0.1:8790/health`. Installed with the main macOS service install unless `NOVA_SKIP_VOICE_GATEWAY_INSTALL=1`. Logs: `tmp/nova-voice-gateway.log`, `tmp/nova-voice-gateway.err.log`. Admin-only in WebUI: Settings → Voice → WebRTC voice gateway (start/stop/restart).
- **Plist**: `/Library/LaunchDaemons/com.nova.localstack.plist`
- **Runner script**: `scripts/start-local-macos-service.sh` → calls `scripts/start-local.sh`
- **Install script**: `sudo bash ./scripts/install-macos-service.sh` (from repo, with **`SUDO_USER` set** — do not use bare `sudo su -`)
- **Logs**: `tmp/nova-localstack.log`, `tmp/nova-localstack.err.log` (under repo root)

The macOS service wrapper sets:

- `NOVA_WEB_HTTPS=true`
- `NOVA_WEB_STANDARD_PORTS=1` (WebUI on **443** HTTPS when cert path works)
- **`NOVA_AGENT_API_COLOCATED=1`** — server-side WebUI calls rewrite `http://nova:…` / `http://nova.local:…` to **`http://127.0.0.1:…`** (Node often cannot resolve the LAN/mDNS name `nova`).
- **`NOVA_AGENT_API_URL`** defaults to **`http://127.0.0.1:8787`** if unset. Override in `.env` only if web and agent are not on the same host.

### After `git pull` on the Mac

```bash
cd /path/to/Nova
git pull
# Restart the daemon (needs sudo on the Mac):
sudo launchctl kickstart -k system/com.nova.localstack
```

If agent-core bind or cert generation fails, see `tmp/nova-localstack.err.log`.

---

## SSH access (operator machine → Nova Mac)

**Cursor agents in a dev workspace may or may not have SSH to your server** — if the user provides `ssh user@host`, you can try non-interactive SSH:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 user@nova "cd ~/projects/Nova && pwd && git status"
```

- **`BatchMode`** avoids hanging on password prompts (requires key-based auth).
- **`sudo` over SSH** often needs a TTY (`ssh -t`) or password — automated agents may not be able to restart LaunchDaemons without the user running sudo locally.

Document for the user: *restart commands that need sudo should be run in their own terminal on the Mac.*

---

## Critical environment variables

| Variable | Purpose |
|----------|---------|
| `NOVA_AGENT_API_URL` | Base URL the **Next.js server** uses to call agent-core; prefer **`http://127.0.0.1:8787`** when web and agent are co-located. Use `NOVA_AGENT_API_COLOCATED` if you still point at `http://nova:8787` in `.env`. |
| `NOVA_AGENT_PORT` | Agent-core listen port (default **8787**). |
| `NOVA_API_TOKEN` | Optional Bearer token for internal/agent calls. |
| `NOVA_WEB_LOGIN_ENABLED` | Override Web login gate (`true`/`false`) if auth state can’t be read. |
| `NOVA_WEB_HTTPS` / `NOVA_WEB_STANDARD_PORTS` | Service mode HTTPS and ports 80/443. |

Repo **`.env`** is loaded by `scripts/start-local.sh` — keep secrets there on the Mac; do not commit.

---

## WebUI ↔ agent-core troubleshooting

If login shows “could not read auth settings from the agent”:

1. Confirm agent-core: `curl -sS http://<host>:8787/v1/auth/state`
2. Confirm WebUI’s resolved URL: `GET /api/auth/state` returns `agentUrl`, `agentForwardedHost`, `agentHost` when unreachable.
3. Fix: set **`NOVA_AGENT_API_URL`** in `.env` to the URL the **Next.js server** can reach (same host as agent-core, correct hostname — not `127.0.0.1` if web runs elsewhere).

---

## Quick health checklist

- `GET /health` on agent-core port
- `GET /v1/auth/state` (public)
- Web: `/login`, `/settings`, `/admin/people` (admin / first user)

---

## Related docs

- [install-nova-complete-guide.md](./install-nova-complete-guide.md) — full install, providers, backup
- [README.md](../README.md) — quick start, features

---

## For Cursor: suggested session preamble

> Nova is a pnpm monorepo. Agent-core is `apps/agent-core`, WebUI is `apps/web`. Start locally with `bash scripts/start-local.sh`. On the Mac server, Nova may run as LaunchDaemon `com.nova.localstack` using `scripts/start-local-macos-service.sh`; logs in `tmp/nova-localstack*.log`. WebUI talks to agent via `NOVA_AGENT_API_URL` (default `http://nova:8787` in the macOS service wrapper). State DB under agent-core `data/state/nova.db`. Read `docs/CURSOR_AGENT_ONBOARDING.md` for SSH/service/restart notes.
