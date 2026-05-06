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
SYSTEM_PLIST="/Library/LaunchDaemons/${LABEL}.plist"
RUNNER="${ROOT_DIR}/scripts/start-local-macos-service.sh"
LOG_OUT="${ROOT_DIR}/tmp/nova-localstack.log"
LOG_ERR="${ROOT_DIR}/tmp/nova-localstack.err.log"

SERVICE_HOME="$(dscl . -read "/Users/${SERVICE_USER}" NFSHomeDirectory 2>/dev/null | sed 's/^[^/]*//')"
if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  SERVICE_HOME="/Users/${SERVICE_USER}"
fi
SERVICE_UID="$(id -u "${SERVICE_USER}")"
AGENT_PLIST="${SERVICE_HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -x "${RUNNER}" ]]; then
  chmod +x "${RUNNER}"
fi

mkdir -p "${ROOT_DIR}/tmp"
touch "${LOG_OUT}" "${LOG_ERR}"
chown "${SERVICE_USER}:staff" "${LOG_OUT}" "${LOG_ERR}"

sudo -u "${SERVICE_USER}" launchctl bootout "user/${SERVICE_UID}/${LABEL}" >/dev/null 2>&1 || true
sudo -u "${SERVICE_USER}" launchctl bootout "gui/${SERVICE_UID}/${LABEL}" >/dev/null 2>&1 || true
rm -f "${AGENT_PLIST}"

write_system_plist() {
  cat > "${SYSTEM_PLIST}" <<EOF
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
  chmod 644 "${SYSTEM_PLIST}"
  chown root:wheel "${SYSTEM_PLIST}"
}

write_agent_plist() {
  mkdir -p "${SERVICE_HOME}/Library/LaunchAgents"
  cat > "${AGENT_PLIST}" <<EOF
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
  chmod 644 "${AGENT_PLIST}"
  chown "${SERVICE_USER}:staff" "${AGENT_PLIST}"
}

install_system_daemon() {
  write_system_plist
  if ! plutil -lint "${SYSTEM_PLIST}"; then
    echo "System plist failed validation." >&2
    return 1
  fi
  launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
  launchctl enable "system/${LABEL}" 2>/dev/null || true
  if launchctl bootstrap "system" "${SYSTEM_PLIST}"; then
    launchctl enable "system/${LABEL}"
    launchctl kickstart -k "system/${LABEL}"
    echo "Installed system LaunchDaemon ${LABEL} (runs as ${SERVICE_USER} via UserName)."
    return 0
  fi
  return 1
}

install_user_agent() {
  rm -f "${SYSTEM_PLIST}"
  launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
  launchctl disable "system/${LABEL}" >/dev/null 2>&1 || true

  write_agent_plist
  if ! plutil -lint "${AGENT_PLIST}"; then
    echo "User LaunchAgent plist failed validation." >&2
    return 1
  fi

  sudo -u "${SERVICE_USER}" launchctl bootout "user/${SERVICE_UID}/${LABEL}" >/dev/null 2>&1 || true
  sudo -u "${SERVICE_USER}" launchctl bootout "gui/${SERVICE_UID}/${LABEL}" >/dev/null 2>&1 || true

  if sudo -u "${SERVICE_USER}" launchctl bootstrap "user/${SERVICE_UID}" "${AGENT_PLIST}"; then
    sudo -u "${SERVICE_USER}" launchctl enable "user/${SERVICE_UID}/${LABEL}"
    sudo -u "${SERVICE_USER}" launchctl kickstart -k "user/${SERVICE_UID}/${LABEL}"
    echo "System daemon bootstrap failed; installed per-user LaunchAgent instead:"
    echo "  ${AGENT_PLIST}"
    echo "(Runs as ${SERVICE_USER}; loads in user/${SERVICE_UID} domain — fine for git; see docs/macos-service.md.)"
    return 0
  fi

  if sudo -u "${SERVICE_USER}" launchctl bootstrap "gui/${SERVICE_UID}" "${AGENT_PLIST}"; then
    sudo -u "${SERVICE_USER}" launchctl enable "gui/${SERVICE_UID}/${LABEL}"
    sudo -u "${SERVICE_USER}" launchctl kickstart -k "gui/${SERVICE_UID}/${LABEL}"
    echo "Installed per-user LaunchAgent (gui domain):"
    echo "  ${AGENT_PLIST}"
    return 0
  fi

  echo "Could not bootstrap LaunchAgent in user/ or gui/ domain." >&2
  return 1
}

if install_system_daemon; then
  :
elif install_user_agent; then
  :
else
  echo "" >&2
  echo "Both system LaunchDaemon and user LaunchAgent installs failed." >&2
  log show --style syslog --predicate "eventMessage CONTAINS[c] '${LABEL}'" --last 3m 2>/dev/null | tail -25 >&2 || true
  exit 1
fi

echo ""
echo "Logs:"
echo "  ${LOG_OUT}"
echo "  ${LOG_ERR}"
echo ""
echo "If .git was damaged by an older root-based install, run once:"
echo "  sudo bash ./scripts/repair-nova-git-ownership.sh"
echo ""
echo "Web UI should be on https://<this-mac-ip>/"
