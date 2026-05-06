#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo:"
  echo "  sudo bash ./scripts/uninstall-macos-service.sh"
  exit 1
fi

LABEL="com.nova.localstack"
SYSTEM_PLIST="/Library/LaunchDaemons/${LABEL}.plist"

launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
launchctl disable "system/${LABEL}" >/dev/null 2>&1 || true
rm -f "${SYSTEM_PLIST}"

UNINSTALL_USER="${SUDO_USER:-}"
if [[ -n "${UNINSTALL_USER}" && "${UNINSTALL_USER}" != "root" ]]; then
  HOME_DIR="$(dscl . -read "/Users/${UNINSTALL_USER}" NFSHomeDirectory 2>/dev/null | sed 's/^[^/]*//')"
  if [[ -z "${HOME_DIR}" || ! -d "${HOME_DIR}" ]]; then
    HOME_DIR="/Users/${UNINSTALL_USER}"
  fi
  AGENT_PLIST="${HOME_DIR}/Library/LaunchAgents/${LABEL}.plist"
  if [[ -f "${AGENT_PLIST}" ]]; then
    UIDN="$(id -u "${UNINSTALL_USER}")"
    launchctl asuser "${UIDN}" sudo -u "${UNINSTALL_USER}" launchctl bootout "user/${UIDN}/${LABEL}" >/dev/null 2>&1 || true
    launchctl asuser "${UIDN}" sudo -u "${UNINSTALL_USER}" launchctl bootout "gui/${UIDN}/${LABEL}" >/dev/null 2>&1 || true
    rm -f "${AGENT_PLIST}"
  fi
fi

echo "Removed ${LABEL} (system daemon and, if present, user LaunchAgent)"
