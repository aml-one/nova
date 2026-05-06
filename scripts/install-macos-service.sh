#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo:"
  echo "  sudo bash ./scripts/install-macos-service.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-}"
if [[ -z "${SERVICE_USER}" || "${SERVICE_USER}" == "root" ]]; then
  echo "Install must be invoked from your login user so the service runs as you (not root), e.g.:" >&2
  echo "  cd ${ROOT_DIR} && sudo bash ./scripts/install-macos-service.sh" >&2
  echo "Avoid: sudo su - then bash install (no SUDO_USER → git would run as root again)." >&2
  exit 1
fi

LABEL="com.nova.localstack"
PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"
RUNNER="${ROOT_DIR}/scripts/start-local-macos-service.sh"
LOG_OUT="${ROOT_DIR}/tmp/nova-localstack.log"
LOG_ERR="${ROOT_DIR}/tmp/nova-localstack.err.log"

SERVICE_HOME="$(dscl . -read "/Users/${SERVICE_USER}" NFSHomeDirectory 2>/dev/null | sed 's/^[^/]*//')"
if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  SERVICE_HOME="/Users/${SERVICE_USER}"
fi

if [[ ! -x "${RUNNER}" ]]; then
  chmod +x "${RUNNER}"
fi

mkdir -p "${ROOT_DIR}/tmp"
touch "${LOG_OUT}" "${LOG_ERR}"
chown "${SERVICE_USER}:staff" "${LOG_OUT}" "${LOG_ERR}"

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

  <key>UserName</key>
  <string>${SERVICE_USER}</string>

  <key>LimitLoadToSessionType</key>
  <string>Background</string>

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
  echo "Plist failed validation; not loading service." >&2
  exit 1
fi

launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
# Sequoia+: enable may need to exist before bootstrap for some labels; harmless on older macOS.
launchctl enable "system/${LABEL}" 2>/dev/null || true
if ! launchctl bootstrap "system" "${PLIST_PATH}"; then
  echo "" >&2
  echo "launchctl bootstrap failed (often fixed by LimitLoadToSessionType=Background + UserName; see docs/macos-service.md)." >&2
  echo "Recent launchd lines:" >&2
  log show --style syslog --predicate "eventMessage CONTAINS[c] '${LABEL}'" --last 3m 2>/dev/null | tail -20 >&2 || true
  exit 1
fi
launchctl enable "system/${LABEL}"
launchctl kickstart -k "system/${LABEL}"

echo "Installed and started ${LABEL} (runs as user ${SERVICE_USER}, not root — safe for git in ~/…)"
echo "Logs:"
echo "  ${LOG_OUT}"
echo "  ${LOG_ERR}"
echo ""
echo "If .git was damaged by an older root-based install, run once:"
echo "  sudo bash ./scripts/repair-nova-git-ownership.sh"
echo ""
echo "Web UI should be on https://<this-mac-ip>/"
