# Run Nova as a macOS service (HTTPS on 443 + auto restart)

This removes the need to SSH and manually run:

`sudo env NOVA_WEB_HTTPS=true NOVA_WEB_STANDARD_PORTS=1 NOVA_WEB_TLS_SAN=... bash ./scripts/start-local.sh`

The supported layout is a **root system LaunchDaemon** (`com.nova.localstack`). Only root can bind **port 443** reliably on macOS, so the service runs `start-local-macos-service.sh` as root. The plist sets **`NOVA_REPO_GIT_CHOWN=${SUDO_USER}:staff`** so agent-core can re-own **`.git`** after `git pull` / identity backup (so your normal user can `git pull` again).

Always install as: `cd …/Nova && sudo bash ./scripts/install-macos-service.sh` — **not** from `sudo su -` (no `SUDO_USER`).

## 1) Install once (on the Mac running Nova)

```bash
cd ~/source/Nova
sudo bash ./scripts/install-macos-service.sh
```

The job includes:

- `KeepAlive=true` (auto restart on crash/exit)
- HTTPS via `start-local-macos-service.sh`
- **Standard ports** (443 for web when `NOVA_WEB_PORT` is unset)
- Dynamic TLS SAN including current `en0` IP each start
- Logs under the repo: `tmp/nova-localstack.log` and `tmp/nova-localstack.err.log`

**Web UI:** `https://<this-mac-LAN-ip>/` (or `https://127.0.0.1/` from the same machine).

## 2) Daily use

- Open Settings → Updates.
- Use **Apply latest**.
- UI shows applying/restarting and auto-reloads when Nova is back.

No manual SSH stop/pull/start should be needed.

## 3) Logs / control

```bash
sudo launchctl print system/com.nova.localstack
tail -f ./tmp/nova-localstack.log
tail -f ./tmp/nova-localstack.err.log
```

## 4) Remove service

```bash
sudo bash ./scripts/uninstall-macos-service.sh
```

This removes the system daemon and any leftover **user** LaunchAgent copy from older installers (same label).

## 5) Troubleshooting: `.git` owned by root / `git pull` fails

If Apply latest or backup already ran as root without `NOVA_REPO_GIT_CHOWN`, fix once:

```bash
sudo bash ./scripts/repair-nova-git-ownership.sh
```

Then reinstall so the plist includes `NOVA_REPO_GIT_CHOWN` (current installer does this automatically).

## 6) Troubleshooting: “dubious ownership” on Apply latest

Nova passes `safe.directory` for the repo during apply on current builds. If you still see it on an older tree, pull manually as your user once, or:

```bash
sudo git config --global --add safe.directory "$(pwd)"
```

## 7) Identity backup: `could not read Username for 'https://github.com': Device not configured`

The button runs `git push` from **agent-core** with **no TTY**. An **`https://github.com/...`** remote needs credentials that work **without** an interactive prompt.

**Recommended:** point the backup remote at SSH (same remote name you use in Settings):

```bash
cd /path/to/Nova
git remote -v
git remote set-url identity-backup git@github.com:YOUR_ORG/YOUR_PRIVATE_REPO.git
```

Use the remote name you configured under **Settings → Backup** (often `identity-backup` or `origin`). Ensure the SSH key under your login user’s `~/.ssh` can push to that repo (the LaunchDaemon sets `HOME` to that user, so Git uses that `~/.ssh` even when the process is root).

**Alternative:** configure a non-interactive HTTPS credential for that host (PAT + `credential.helper store`, or a token embedded in the URL — treat as a secret).

## 8) Safe updates: automatic rollback when an update breaks Nova

Every in-app `Apply latest` is now a guarded deploy. Before `git pull`, agent-core writes a small marker file `tmp/.nova-update-applied` containing the previous commit SHA. The supervisor (`start-local.sh`) sees the marker on the next stack restart and watches `agent-core` more strictly while it warms up:

- Grace period: `NOVA_POST_UPDATE_GRACE_SECONDS` (default `90s`) before any health failure counts.
- Failure threshold: `NOVA_POST_UPDATE_FAIL_THRESHOLD` (default `4`) consecutive failed `/v1/health` probes.
- Hard deadline: `NOVA_POST_UPDATE_DEADLINE_SECONDS` (default `300s`) — even a process that's alive but never healthy triggers rollback.

If any of those trip, the supervisor runs `git reset --hard <previous-sha>`, `pnpm install`, removes the marker, and starts the stack again on the previous commit. A second marker (`tmp/.nova-update-rolled-back`) records when/what was reverted.

The Settings → Updates panel surfaces both: a yellow banner while the post-update probe is in flight, and a separate banner if the most recent update was auto-reverted.

To force a rollback manually (e.g. you broke local dev and want the supervisor to fix it on the next restart), just write the marker yourself:

```bash
PREV=$(git rev-parse HEAD@{1})  # or any known-good SHA
mkdir -p ./tmp
printf 'prev_sha=%s\napplied_at=%s\n' "${PREV}" "$(date -u +%FT%TZ)" > ./tmp/.nova-update-applied
sudo launchctl kickstart -k system/com.nova.localstack
```

## 9) Troubleshooting: `Bootstrap failed: 5: Input/output error`

Often a **bad or stale plist**, SIP/domain quirks, or a duplicate label. Try:

```bash
sudo plutil -lint /Library/LaunchDaemons/com.nova.localstack.plist
sudo launchctl bootout system/com.nova.localstack
sudo bash ./scripts/install-macos-service.sh
```

```bash
log show --style syslog --predicate 'eventMessage CONTAINS[c] "com.nova.localstack"' --last 5m | tail -40
```
