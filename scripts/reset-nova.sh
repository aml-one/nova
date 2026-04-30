#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NOW="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT_DIR/data/reset-backups"
STATE_DIR="$ROOT_DIR/data/state"
IDENTITY_ARCHIVE_DIR="$ROOT_DIR/data/identity-archive"
PERSONAS_DIR="$ROOT_DIR/config/personas"

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
  pkill -f "tsx watch src/index.ts" >/dev/null 2>&1 || true
  pkill -f "next dev" >/dev/null 2>&1 || true
}

create_backups() {
  mkdir -p "$BACKUP_DIR"
  echo "Creating safety backup snapshot..."
  if [[ -d "$STATE_DIR" ]]; then
    cp -R "$STATE_DIR" "$BACKUP_DIR/state-$NOW"
    echo "  - backed up data/state -> data/reset-backups/state-$NOW"
  fi
  if [[ -d "$IDENTITY_ARCHIVE_DIR" ]]; then
    cp -R "$IDENTITY_ARCHIVE_DIR" "$BACKUP_DIR/identity-archive-$NOW"
    echo "  - backed up data/identity-archive -> data/reset-backups/identity-archive-$NOW"
  fi
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
  rm -f "$STATE_DIR/learning-log.json"
  rm -f "$STATE_DIR/curiosity-store.json"
  echo -e "${GREEN}Soft reset complete.${RESET}"
}

perform_hard_reset() {
  echo "Running hard reset..."
  rm -rf "$STATE_DIR"
  rm -rf "$IDENTITY_ARCHIVE_DIR"
  echo -e "${GREEN}Hard reset complete.${RESET}"
}

perform_factory_reset() {
  echo "Running factory reset..."
  rm -rf "$STATE_DIR"
  rm -rf "$IDENTITY_ARCHIVE_DIR"
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
  echo -e "${GREEN}Done.${RESET} You can restart Nova with:"
  echo "  bash ./scripts/start-local.sh"
}

main "$@"

