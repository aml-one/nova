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

## 7) Troubleshooting: `Bootstrap failed: 5: Input/output error`

Often a **bad or stale plist**, SIP/domain quirks, or a duplicate label. Try:

```bash
sudo plutil -lint /Library/LaunchDaemons/com.nova.localstack.plist
sudo launchctl bootout system/com.nova.localstack
sudo bash ./scripts/install-macos-service.sh
```

```bash
log show --style syslog --predicate 'eventMessage CONTAINS[c] "com.nova.localstack"' --last 5m | tail -40
```
