#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo:"
  echo "  sudo bash ./scripts/uninstall-macos-service.sh"
  exit 1
fi

LABEL="com.nova.localstack"
PLIST_PATH="/Library/LaunchDaemons/${LABEL}.plist"

launchctl bootout system/${LABEL} >/dev/null 2>&1 || true
launchctl disable system/${LABEL} >/dev/null 2>&1 || true
rm -f "${PLIST_PATH}"

echo "Removed ${LABEL}"
