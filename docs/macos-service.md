# Run Nova as a macOS service (HTTPS + auto restart)

This removes the need to SSH and manually run:

`sudo env NOVA_WEB_HTTPS=true NOVA_WEB_STANDARD_PORTS=1 NOVA_WEB_TLS_SAN=... bash ./scripts/start-local.sh`

## 1) Install once (on the Mac running Nova)

```bash
cd ~/source/Nova
sudo bash ./scripts/install-macos-service.sh
```

It installs `com.nova.localstack` as a LaunchDaemon with:
- **`UserName` = the account that ran `sudo`** (`SUDO_USER`) so **git / pnpm never run as root** in your checkout (avoids root-owned `.git/objects` and lockouts).
- `KeepAlive=true` (auto restart on crash/exit)
- HTTPS enabled
- standard ports (443 for web)
- dynamic TLS SAN including current `en0` IP each start
- Logs under the repo: `tmp/nova-localstack.log` and `tmp/nova-localstack.err.log` (writable by that user)

Always install as: `cd …/Nova && sudo bash ./scripts/install-macos-service.sh` — **not** from `sudo su -` (no `SUDO_USER`).

## 2) Daily use

- Open Settings -> Updates.
- Use **Apply latest**.
- UI now shows "applying/restarting" and auto-reloads when Nova is back.

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

## 5) Troubleshooting: “dubious ownership” on Apply latest

Nova’s updater runs `git pull` from **agent-core**. If the LaunchDaemon runs that process as **root** while the repo directory is owned by your user (`ambrus`), Git 2.35+ prints:

```text
fatal: detected dubious ownership in repository at '...'
```

**Preferred fix (built in):** current Nova passes `safe.directory` for the repo **only during the apply command**, so Apply latest works without touching global Git config. Pull the newest code once (manual `git pull` in your repo as your user), restart the stack, then use Apply latest again.

**Manual alternative (global, for root’s Git):** if you still see the error on an older build:

```bash
sudo git config --global --add safe.directory /Users/ambrus/projects/Nova
```

Use your real checkout path (`pwd` inside the Nova repo).

**Why it happened on older installs:** the plist used to omit `UserName`, so the job ran as **root** and `git` wrote root-owned objects under `.git/`. Re-run **`sudo bash ./scripts/install-macos-service.sh`** from your user (see above), then once:

```bash
sudo bash ./scripts/repair-nova-git-ownership.sh
```

so existing `.git` ownership is repaired.

## 6) Troubleshooting: `Bootstrap failed: 5: Input/output error`

This is a generic launchd error. For Nova’s plist, common causes were:

- **Missing `LimitLoadToSessionType`:** system jobs with `UserName` must not default to an Aqua GUI session. Current installer sets **`LimitLoadToSessionType` = `Background`**.
- **Bad plist:** run `sudo plutil -lint /Library/LaunchDaemons/com.nova.localstack.plist`.
- **Stale job name:** `sudo launchctl bootout system/com.nova.localstack` then re-run the installer.
- **Logs not writable:** logs live under the repo `tmp/` and are `chown`’d to your user before load.

If it still fails, capture recent launchd lines (replace the label if you changed it):

```bash
log show --style syslog --predicate 'eventMessage CONTAINS[c] "com.nova.localstack"' --last 5m | tail -40
```
