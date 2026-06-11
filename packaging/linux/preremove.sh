#!/bin/sh
set -eu

action="${1:-remove}"
if [ "$action" = "remove" ] || [ "$action" = "0" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now morecode.service || true
  fi
fi

