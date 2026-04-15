#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
snapshot_dir="${repo_root}/.logs/issue-2007/process-snapshots"
process_pattern='(^|/|[[:space:]])claude([[:space:]]|$)|codex app-server|src/bin.ts|T3 Code|Electron'
label=""

usage() {
  cat <<'EOF'
Usage: ./scripts/issue-2007-process-snapshot.sh [--label <name>]

Print the Issue #2007 process snapshot used in the reproduction guide.
When --label is provided, the snapshot is also written under:
  .logs/issue-2007/process-snapshots/
EOF
}

sanitize_label() {
  local value="$1"
  value="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  value="$(printf '%s' "${value}" | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
  if [[ -z "${value}" ]]; then
    value="snapshot"
  fi
  printf '%s\n' "${value}"
}

render_snapshot() {
  printf '\n=== %s ===\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
  echo "-- pgrep --"
  pgrep -fal "${process_pattern}" || true
  echo "-- ps --"
  ps -Ao pid,ppid,etime,rss,command | grep -E "${process_pattern}" | grep -v "grep -E" || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      if [[ $# -lt 2 ]]; then
        echo "Error: --label requires a value." >&2
        exit 1
      fi
      label="$2"
      shift 2
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

if [[ -n "${label}" ]]; then
  mkdir -p "${snapshot_dir}"
  snapshot_path="${snapshot_dir}/$(date -u '+%Y%m%dT%H%M%SZ')-$(sanitize_label "${label}").txt"
  render_snapshot | tee "${snapshot_path}"
  printf '\nSaved snapshot to %s\n' "${snapshot_path}" >&2
  exit 0
fi

render_snapshot
