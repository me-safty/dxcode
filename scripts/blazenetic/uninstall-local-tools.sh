#!/usr/bin/env bash
# uninstall-local-tools.sh — remove ONLY the local integration created by
# install-local-tools.sh: the t3b* symlinks in ~/.local/bin and the rendered
# KDE launcher. Idempotent.
#
# Does NOT remove: the repository, ~/.config/t3code-blazenetic (user config),
# application data, bun, system packages, or git remotes.
set -Eeuo pipefail

_self="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$_self")"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat >&2 <<'EOF'
Usage: uninstall-local-tools.sh
  Remove the t3b* symlinks and the KDE launcher installed by
  install-local-tools.sh. Leaves the repo and user config intact.
EOF
}
case "${1:-}" in -h|--help) usage; exit 0 ;; esac

BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
DESKTOP_DST="$APP_DIR/t3code-blazenetic-dev.desktop"
WRAPPERS=(t3b t3b-web t3b-desktop t3b-sync t3b-check t3b-doctor t3b-shell)

removed=0
for w in "${WRAPPERS[@]}"; do
  dst="$BIN_DIR/$w"
  if [[ -L "$dst" ]]; then
    target="$(readlink -f "$dst" 2>/dev/null || true)"
    # Only remove symlinks that point back into this repo.
    if [[ "$target" == "$REPO_ROOT"/* ]]; then
      rm -f "$dst"
      t3b::status OK "removed symlink $w"
      removed=$((removed + 1))
    else
      t3b::status WARN "$w points outside this repo — leaving it: $target"
    fi
  elif [[ -e "$dst" ]]; then
    t3b::status WARN "$w is not a symlink — leaving it untouched"
  fi
done

# Remove the launcher only if it carries our management marker.
if [[ -f "$DESKTOP_DST" ]]; then
  if grep -q '^X-T3B-Managed=true' "$DESKTOP_DST"; then
    rm -f "$DESKTOP_DST"
    t3b::status OK "removed KDE launcher"
    removed=$((removed + 1))
    if t3b::have update-desktop-database; then
      update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
    fi
  else
    t3b::status WARN "KDE launcher lacks our marker — leaving it untouched"
  fi
fi

if [[ "$removed" -eq 0 ]]; then
  t3b::info "Nothing to remove (already uninstalled)."
else
  t3b::info "Removed $removed item(s). Repo and ~/.config/t3code-blazenetic left intact."
fi
