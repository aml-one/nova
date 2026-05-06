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
  echo "Install must be invoked from your login user (for recording who owns the checkout), e.g.:" >&2
  echo "  cd ${ROOT_DIR} && sudo bash ./scripts/install-macos-service.sh" >&2
  echo "Avoid: sudo su - (no SUDO_USER)." >&2
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
SERVICE_UID="$(id -u "${SERVICE_USER}")"
AGENT_PLIST="${SERVICE_HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -x "${RUNNER}" ]]; then
  chmod +x "${RUNNER}"
fi

mkdir -p "${ROOT_DIR}/tmp"
touch "${LOG_OUT}" "${LOG_ERR}"
chown "${SERVICE_USER}:staff" "${LOG_OUT}" "${LOG_ERR}" 2>/dev/null || true

# Remove any earlier per-user LaunchAgent copy (avoids duplicate labels / confusing launchd state).
rm -f "${AGENT_PLIST}"
launchctl asuser "${SERVICE_UID}" sudo -u "${SERVICE_USER}" launchctl bootout "user/${SERVICE_UID}/${LABEL}" >/dev/null 2>&1 || true
launchctl asuser "${SERVICE_UID}" sudo -u "${SERVICE_USER}" launchctl bootout "gui/${SERVICE_UID}/${LABEL}" >/dev/null 2>&1 || true

# Root LaunchDaemon: can bind :443 again. Git runs as root; agent-core re-chowns .git when NOVA_REPO_GIT_CHOWN is set.
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

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${SERVICE_HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NOVA_REPO_GIT_CHOWN</key>
    <string>${SERVICE_USER}:staff</string>
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

launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
launchctl enable "system/${LABEL}" 2>/dev/null || true
if ! launchctl bootstrap "system" "${PLIST_PATH}"; then
  echo "launchctl bootstrap failed." >&2
  log show --style syslog --predicate "eventMessage CONTAINS[c] '${LABEL}'" --last 3m 2>/dev/null | tail -25 >&2 || true
  exit 1
fi
launchctl enable "system/${LABEL}"
launchctl kickstart -k "system/${LABEL}"

echo "Installed ${LABEL} as root LaunchDaemon (HTTPS on 443)."
echo "After git pull / identity backup, agent-core will: chown -R ${SERVICE_USER}:staff .git (via NOVA_REPO_GIT_CHOWN)."
echo ""
echo "Logs:"
echo "  ${LOG_OUT}"
echo "  ${LOG_ERR}"
echo ""
echo "One-time if .git is already root-owned:"
echo "  sudo bash ./scripts/repair-nova-git-ownership.sh"
echo ""
echo "Web UI: https://<this-mac-ip>/"
