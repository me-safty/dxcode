#!/usr/bin/env bash
# install-local-tools.sh — install the t3b* wrappers and KDE launcher at USER
# scope. Idempotent. Symlinks (not copies) the wrappers so edits to the repo
# scripts take effect immediately with no reinstall.
#
# Does NOT: install system/AUR packages, use sudo, modify shell rc files,
# download executables, install global npm packages, or touch system-wide
# desktop entries.
set -Eeuo pipefail

_self="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$_self")"          # .../scripts/blazenetic
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat >&2 <<'EOF'
Usage: install-local-tools.sh [--doctor]
  Symlink t3b* commands into ~/.local/bin and install the KDE launcher into
  ~/.local/share/applications. Idempotent and safe to re-run.
    --doctor   run t3b-doctor after installing
EOF
}
run_doctor=0
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --doctor)  run_doctor=1 ;;
  "")        ;;
  *)         t3b::err "Unknown option: $1"; usage; exit 2 ;;
esac

BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
CFG_DIR="$HOME/.config/t3code-blazenetic"
DESKTOP_SRC="$REPO_ROOT/packaging/linux/t3code-blazenetic-dev.desktop"
DESKTOP_DST="$APP_DIR/t3code-blazenetic-dev.desktop"

WRAPPERS=(t3b t3b-web t3b-desktop t3b-sync t3b-check t3b-doctor t3b-shell)

t3b::info "Repo root:   $REPO_ROOT"
t3b::info "Install dir: $BIN_DIR"

mkdir -p "$BIN_DIR" "$CFG_DIR"

# --- symlink wrappers -------------------------------------------------------
for w in "${WRAPPERS[@]}"; do
  src="$SCRIPT_DIR/$w"
  dst="$BIN_DIR/$w"
  if [[ ! -f "$src" ]]; then
    t3b::warn "Source wrapper missing, skipping: $src"
    continue
  fi
  chmod +x "$src"
  if [[ -L "$dst" ]]; then
    if [[ "$(readlink -f "$dst")" == "$(readlink -f "$src")" ]]; then
      t3b::status OK "$w (already linked)"
      continue
    fi
    ln -sfn "$src" "$dst"
    t3b::status OK "$w (relinked)"
  elif [[ -e "$dst" ]]; then
    t3b::status WARN "$w exists and is NOT a symlink — leaving it untouched: $dst"
    t3b::warn "Remove it yourself if you want the t3b wrapper to take over."
  else
    ln -s "$src" "$dst"
    t3b::status OK "$w (linked)"
  fi
done

# --- KDE desktop entry ------------------------------------------------------
if [[ -f "$DESKTOP_SRC" ]]; then
  mkdir -p "$APP_DIR"
  desktop_bin="$BIN_DIR/t3b-desktop"
  # Render the template: substitute the absolute wrapper path. Use a temp file
  # then move into place so a concurrent read never sees a half-written file.
  tmp="$(mktemp "${TMPDIR:-/tmp}/t3b-desktop.XXXXXX")"
  sed "s|@T3B_DESKTOP_BIN@|$desktop_bin|g" "$DESKTOP_SRC" > "$tmp"
  mv "$tmp" "$DESKTOP_DST"
  chmod 644 "$DESKTOP_DST"
  t3b::status OK "KDE launcher installed: $DESKTOP_DST"
  if t3b::have update-desktop-database; then
    update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
  fi
else
  t3b::status WARN "Desktop template not found, skipping launcher: $DESKTOP_SRC"
fi

# --- PATH advice (never edits shell files) ----------------------------------
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    t3b::warn "$BIN_DIR is not on your PATH."
    t3b::warn "Add this line to ~/.zshrc, then restart your shell:"
    t3b::warn "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

t3b::info "Install complete."
if [[ "$run_doctor" -eq 1 ]]; then
  t3b::heading "Running t3b-doctor"
  "$SCRIPT_DIR/t3b-doctor" || true
fi
