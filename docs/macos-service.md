# Run Nova as a macOS service (HTTPS + auto restart)

This removes the need to SSH and manually run:

`sudo env NOVA_WEB_HTTPS=true NOVA_WEB_STANDARD_PORTS=1 NOVA_WEB_TLS_SAN=... bash ./scripts/start-local.sh`

## 1) Install once (on the Mac running Nova)

```bash
cd ~/source/Nova
sudo bash ./scripts/install-macos-service.sh
```

It installs `com.nova.localstack` as a LaunchDaemon with:
- `KeepAlive=true` (auto restart on crash/exit)
- HTTPS enabled
- standard ports (443 for web)
- dynamic TLS SAN including current `en0` IP each start

## 2) Daily use

- Open Settings -> Updates.
- Use **Apply latest**.
- UI now shows "applying/restarting" and auto-reloads when Nova is back.

No manual SSH stop/pull/start should be needed.

## 3) Logs / control

```bash
sudo launchctl print system/com.nova.localstack
tail -f /var/log/nova-localstack.log
tail -f /var/log/nova-localstack.err.log
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

**Why it happens:** system LaunchDaemons run as root by default; your project lives under `/Users/ambrus/...` owned by `ambrus`. Git refuses cross-user repos unless explicitly allowed.
