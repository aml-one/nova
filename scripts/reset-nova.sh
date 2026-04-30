#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NOW="$(date +%Y%m%d-%H%M%S)"
PERSONAS_DIR="$ROOT_DIR/config/personas"
BACKUP_ROOTS=(
  "$ROOT_DIR/data/reset-backups"
  "$ROOT_DIR/apps/agent-core/data/reset-backups"
)
STATE_DIRS=(
  "$ROOT_DIR/data/state"
  "$ROOT_DIR/apps/agent-core/data/state"
)
IDENTITY_ARCHIVE_DIRS=(
  "$ROOT_DIR/data/identity-archive"
  "$ROOT_DIR/apps/agent-core/data/identity-archive"
)

RED="\033[31m"
YELLOW="\033[33m"
GREEN="\033[32m"
RESET="\033[0m"

print_header() {
  echo "============================================="
  echo "Nova Reset Utility (multi-confirm protected)"
  echo "============================================="
  echo
}

warn_destructive() {
  echo -e "${RED}WARNING: This operation is destructive.${RESET}"
  echo "It can remove Nova runtime memory/history files."
  echo
}

stop_local_processes() {
  echo "Stopping local Nova processes (if running)..."
  pkill -f "scripts/start-local.sh" >/dev/null 2>&1 || true
  pkill -f "start-local.sh" >/dev/null 2>&1 || true
  pkill -f "tsx watch src/index.ts" >/dev/null 2>&1 || true
  pkill -f "next dev" >/dev/null 2>&1 || true
  pkill -f "@nova/agent-core@0.1.0 dev" >/dev/null 2>&1 || true
  pkill -f "@nova/web@0.1.0 dev" >/dev/null 2>&1 || true
  sleep 1
}

create_backups() {
  echo "Creating safety backup snapshot..."
  for backup_dir in "${BACKUP_ROOTS[@]}"; do
    mkdir -p "$backup_dir"
  done
  local index=0
  for state_dir in "${STATE_DIRS[@]}"; do
    local backup_dir="${BACKUP_ROOTS[$index]}"
    if [[ -d "$state_dir" ]]; then
      cp -R "$state_dir" "$backup_dir/state-$NOW"
      echo "  - backed up $state_dir -> $backup_dir/state-$NOW"
    fi
    index=$((index + 1))
  done
  index=0
  for archive_dir in "${IDENTITY_ARCHIVE_DIRS[@]}"; do
    local backup_dir="${BACKUP_ROOTS[$index]}"
    if [[ -d "$archive_dir" ]]; then
      cp -R "$archive_dir" "$backup_dir/identity-archive-$NOW"
      echo "  - backed up $archive_dir -> $backup_dir/identity-archive-$NOW"
    fi
    index=$((index + 1))
  done
}

confirm_yes_no() {
  local prompt="$1"
  local answer=""
  read -r -p "$prompt [yes/no]: " answer
  local normalized
  normalized="$(printf "%s" "$answer" | tr '[:upper:]' '[:lower:]')"
  [[ "$normalized" == "yes" ]]
}

confirm_typed() {
  local expected="$1"
  local typed=""
  read -r -p "Type '$expected' to continue: " typed
  [[ "$typed" == "$expected" ]]
}

perform_soft_reset() {
  echo "Running soft reset..."
  for state_dir in "${STATE_DIRS[@]}"; do
    rm -f "$state_dir/learning-log.json"
    rm -f "$state_dir/curiosity-store.json"
  done
  echo -e "${GREEN}Soft reset complete.${RESET}"
}

perform_hard_reset() {
  echo "Running hard reset..."
  for state_dir in "${STATE_DIRS[@]}"; do
    rm -rf "$state_dir"
  done
  for archive_dir in "${IDENTITY_ARCHIVE_DIRS[@]}"; do
    rm -rf "$archive_dir"
  done
  echo -e "${GREEN}Hard reset complete.${RESET}"
}

perform_factory_reset() {
  echo "Running factory reset..."
  for state_dir in "${STATE_DIRS[@]}"; do
    rm -rf "$state_dir"
  done
  for archive_dir in "${IDENTITY_ARCHIVE_DIRS[@]}"; do
    rm -rf "$archive_dir"
  done
  rm -rf "$PERSONAS_DIR"
  echo -e "${GREEN}Factory reset complete.${RESET}"
}

show_mode_help() {
  echo "Reset modes:"
  echo "  1) soft    -> clear learning loop artifacts only"
  echo "  2) hard    -> wipe state DB + identity archive"
  echo "  3) factory -> hard reset + remove custom personas"
  echo
}

main() {
  print_header
  show_mode_help

  local choice=""
  read -r -p "Choose reset mode (1/2/3): " choice

  local mode=""
  local typed_guard=""
  case "$choice" in
    1) mode="soft"; typed_guard="SOFT-RESET" ;;
    2) mode="hard"; typed_guard="HARD-RESET" ;;
    3) mode="factory"; typed_guard="FACTORY-RESET" ;;
    *)
      echo "Invalid choice. Exiting."
      exit 1
      ;;
  esac

  warn_destructive
  echo -e "${YELLOW}Selected mode: ${mode}${RESET}"
  echo

  # Confirmation 1
  if ! confirm_yes_no "Confirmation 1: Do you want to proceed with '$mode' reset?"; then
    echo "Cancelled."
    exit 0
  fi

  # Confirmation 2
  if ! confirm_typed "$typed_guard"; then
    echo "Typed confirmation failed. Cancelled."
    exit 1
  fi

  # Confirmation 3
  if ! confirm_yes_no "Final confirmation: This cannot be undone without backups. Continue?"; then
    echo "Cancelled."
    exit 0
  fi

  stop_local_processes
  create_backups

  case "$mode" in
    soft) perform_soft_reset ;;
    hard) perform_hard_reset ;;
    factory) perform_factory_reset ;;
  esac

  echo
  echo "Post-reset verification:"
  for state_dir in "${STATE_DIRS[@]}"; do
    if [[ -d "$state_dir" ]]; then
      echo "  - still present: $state_dir (will be recreated on next start if services are running)"
    else
      echo "  - removed: $state_dir"
    fi
  done
  for archive_dir in "${IDENTITY_ARCHIVE_DIRS[@]}"; do
    if [[ -d "$archive_dir" ]]; then
      echo "  - still present: $archive_dir"
    else
      echo "  - removed: $archive_dir"
    fi
  done

  echo
  echo -e "${GREEN}Done.${RESET} You can restart Nova with:"
  echo "  bash ./scripts/start-local.sh"
  echo
  echo "If old chat/session UI data remains, clear browser localStorage for http://localhost:3000."
}

main "$@"


