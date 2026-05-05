#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo:"
  echo "  sudo bash ./scripts/install-macos-service.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.nova.localstack"
PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"
RUNNER="${ROOT_DIR}/scripts/start-local-macos-service.sh"

if [[ ! -x "${RUNNER}" ]]; then
  chmod +x "${RUNNER}"
fi

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RUNNER}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/var/log/nova-localstack.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/nova-localstack.err.log</string>
</dict>
</plist>
EOF

chmod 644 "${PLIST_PATH}"
chown root:wheel "${PLIST_PATH}"

launchctl bootout system/${LABEL} >/dev/null 2>&1 || true
launchctl bootstrap system "${PLIST_PATH}"
launchctl enable system/${LABEL}
launchctl kickstart -k system/${LABEL}

echo "Installed and started ${LABEL}"
echo "Logs:"
echo "  /var/log/nova-localstack.log"
echo "  /var/log/nova-localstack.err.log"
echo ""
echo "Web UI should be on https://<this-mac-ip>/"
