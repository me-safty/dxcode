#!/usr/bin/env bash
set -euo pipefail

mode="list"
claude_pattern='(^|/|[[:space:]])claude([[:space:]]|$)'

usage() {
  cat <<'EOF'
Usage: ./scripts/issue-2007-claude-processes.sh [--count]

List Claude-related processes for Issue #2007 reproduction checks.
Use --count when a case only needs the current process total.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count)
      mode="count"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${mode}" == "count" ]]; then
  printf '%s\n' "$(pgrep -fal "${claude_pattern}" 2>/dev/null | wc -l | tr -d '[:space:]')"
  exit 0
fi

pgrep -fal "${claude_pattern}" || true
