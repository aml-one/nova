#!/usr/bin/env bash
set -euo pipefail
#
# One-shot: fix .git/objects owned by root after the service used to run git as root.
# Usage (from your Mac login, not a root-only shell):
#   cd /path/to/Nova && sudo bash ./scripts/repair-nova-git-ownership.sh
#
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run with sudo from your repo:"
  echo "  sudo bash ./scripts/repair-nova-git-ownership.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${SUDO_USER:-}"
if [[ -z "${OWNER}" || "${OWNER}" == "root" ]]; then
  echo "Run as: sudo bash ./scripts/repair-nova-git-ownership.sh" >&2
  echo "so SUDO_USER is your normal macOS account (not a pure root shell)." >&2
  exit 1
fi

if [[ ! -d "${REPO_ROOT}/.git" ]]; then
  echo "No .git at ${REPO_ROOT}" >&2
  exit 1
fi

chown -R "${OWNER}:staff" "${REPO_ROOT}/.git"
echo "Re-owned ${REPO_ROOT}/.git to ${OWNER}:staff"
