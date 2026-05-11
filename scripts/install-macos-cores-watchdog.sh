#!/usr/bin/env bash
# Install LaunchDaemons that supervise Orpheus (5005/5006) and MemoryBear (8000) on macOS.
# Same model as com.nova.voice-gateway: root plist, UserName=SUDO_USER, long-running runner + launchd KeepAlive.
#
# Install (from Nova repo, as your login user — not bare sudo su):
#   cd /path/to/Nova && sudo bash ./scripts/install-macos-cores-watchdog.sh
#
# Uninstall:
#   sudo bash ./scripts/install-macos-cores-watchdog.sh --uninstall
#
# Env (optional, for install-time only — edit plist or use defaults in runner):
#   NOVA_SKIP_CORES_WATCHDOG_INSTALL=1  — when sourced from install-macos-service.sh, skip entirely.
#
set -euo pipefail

if [[ "${1:-}" == "--uninstall" ]]; then
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Run uninstall with sudo:" >&2
    echo "  sudo bash ./scripts/install-macos-cores-watchdog.sh --uninstall" >&2
    exit 1
  fi
  for LABEL in com.nova.orpheus-watchdog com.nova.memorybear-watchdog; do
    launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
    rm -f "/Library/LaunchDaemons/${LABEL}.plist"
    echo "Removed ${LABEL}"
  done
  echo "Uninstall done."
  exit 0
fi

if [[ "${NOVA_SKIP_CORES_WATCHDOG_INSTALL:-}" == "1" ]]; then
  echo "Skipping cores watchdog (NOVA_SKIP_CORES_WATCHDOG_INSTALL=1)."
  exit 0
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo:"
  echo "  sudo bash ./scripts/install-macos-cores-watchdog.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-}"
if [[ -z "${SERVICE_USER}" || "${SERVICE_USER}" == "root" ]]; then
  echo "Install must be invoked with SUDO_USER set (e.g. cd ${ROOT_DIR} && sudo bash ./scripts/install-macos-cores-watchdog.sh)." >&2
  exit 1
fi

SERVICE_HOME="$(dscl . -read "/Users/${SERVICE_USER}" NFSHomeDirectory 2>/dev/null | sed 's/^[^/]*//')"
if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  SERVICE_HOME="/Users/${SERVICE_USER}"
fi
install_one() {
  local LABEL="$1" RUNNER="$2" LOG_OUT="$3" LOG_ERR="$4"

  if [[ ! -f "${RUNNER}" ]]; then
    echo "ERROR: runner missing: ${RUNNER}" >&2
    exit 1
  fi
  chmod +x "${RUNNER}" 2>/dev/null || true

  local PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"
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
  <key>ThrottleInterval</key>
  <integer>30</integer>

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
    echo "Plist failed validation: ${PLIST_PATH}" >&2
    exit 1
  fi

  launchctl bootstrap "system" "${PLIST_PATH}"
  launchctl enable "system/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "system/${LABEL}"
  echo "Installed ${LABEL}"
}

install_one \
  "com.nova.orpheus-watchdog" \
  "${ROOT_DIR}/scripts/orpheus-macos-watchdog-runner.sh" \
  "${ROOT_DIR}/tmp/nova-orpheus-watchdog.log" \
  "${ROOT_DIR}/tmp/nova-orpheus-watchdog.err.log"

install_one \
  "com.nova.memorybear-watchdog" \
  "${ROOT_DIR}/scripts/memorybear-macos-watchdog-runner.sh" \
  "${ROOT_DIR}/tmp/nova-memorybear-watchdog.log" \
  "${ROOT_DIR}/tmp/nova-memorybear-watchdog.err.log"

echo ""
echo "Cores watchdog installed. Logs under ${ROOT_DIR}/tmp/nova-*-watchdog*.log"
echo "Control:"
echo "  sudo launchctl kickstart -k system/com.nova.orpheus-watchdog"
echo "  sudo launchctl kickstart -k system/com.nova.memorybear-watchdog"
echo "Uninstall:"
echo "  sudo bash ${ROOT_DIR}/scripts/install-macos-cores-watchdog.sh --uninstall"
