#!/usr/bin/env bash
# Install LaunchDaemon com.nova.voice-gateway (WebRTC voice bridge). Run with sudo from repo root.
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo:"
  echo "  sudo bash ./scripts/install-macos-voice-gateway-service.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-}"
if [[ -z "${SERVICE_USER}" || "${SERVICE_USER}" == "root" ]]; then
  echo "Install must be invoked from your login user (SUDO_USER), e.g.:" >&2
  echo "  cd ${ROOT_DIR} && sudo bash ./scripts/install-macos-voice-gateway-service.sh" >&2
  exit 1
fi

RUNNER="${ROOT_DIR}/scripts/voice-gateway-macos-runner.sh"
LABEL="com.nova.voice-gateway"
PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"
LOG_OUT="${ROOT_DIR}/tmp/nova-voice-gateway.log"
LOG_ERR="${ROOT_DIR}/tmp/nova-voice-gateway.err.log"

SERVICE_HOME="$(dscl . -read "/Users/${SERVICE_USER}" NFSHomeDirectory 2>/dev/null | sed 's/^[^/]*//')"
if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  SERVICE_HOME="/Users/${SERVICE_USER}"
fi

if [[ ! -x "${RUNNER}" ]]; then
  chmod +x "${RUNNER}"
fi

mkdir -p "${ROOT_DIR}/tmp"
touch "${LOG_OUT}" "${LOG_ERR}"
chown "${SERVICE_USER}:staff" "${LOG_OUT}" "${LOG_ERR}" 2>/dev/null || true

launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>UserName</key>
  <string>${SERVICE_USER}</string>
  <key>GroupName</key>
  <string>staff</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RUNNER}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${SERVICE_HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>
</dict>
</plist>
EOF

chmod 644 "${PLIST_PATH}"
chown root:wheel "${PLIST_PATH}"

if ! plutil -lint "${PLIST_PATH}"; then
  echo "Plist failed validation." >&2
  exit 1
fi

launchctl bootstrap "system" "${PLIST_PATH}"
launchctl enable "system/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "system/${LABEL}"

echo "Installed ${LABEL}. Logs:"
echo "  ${LOG_OUT}"
echo "  ${LOG_ERR}"
echo "HTTP health: http://127.0.0.1:8790/health"
