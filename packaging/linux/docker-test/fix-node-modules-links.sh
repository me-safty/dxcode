#!/bin/sh
set -eu

node_modules_dir="${1:-/opt/morecode/node_modules}"

if [ ! -d "$node_modules_dir" ]; then
  exit 0
fi

repair_links() {
  dir="$1"
  for entry in "$dir"/*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    if [ -L "$entry" ]; then
      target=$(readlink "$entry")
      case "$target" in
        /*)
          case "$target" in
            */node_modules/.pnpm/*)
              relative_target=".pnpm/${target#*/node_modules/.pnpm/}"
              rm -f "$entry"
              ln -s "$relative_target" "$entry"
              ;;
          esac
          ;;
      esac
      continue
    fi
    case "$entry" in
      */.pnpm) ;;
      */@*)
        repair_links "$entry"
        ;;
    esac
  done
}

repair_links "$node_modules_dir"