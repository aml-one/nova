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
