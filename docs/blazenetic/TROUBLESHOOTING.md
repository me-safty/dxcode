# Troubleshooting

Run `t3b-doctor` first — it detects most of the problems below and prints the
exact fix.

## Toolchain

### `vp` not found / Vite+ not installed

```bash
curl -fsSL https://vite.plus | bash
# restart your shell, then:
vp --version
```

If it's installed but not found in a fresh shell, ensure `~/.vite-plus/bin` is on
PATH (the installer adds it to your shell rc; restart the shell). The wrappers
add it automatically as a fallback.

### `vpr` not found

`vpr` is the standalone alias for `vp run`, set up as a shell function by the
Vite+ installer. It only exists in interactive shells that sourced the Vite+ env.
The wrappers use `vp run` directly, so this never affects them. Use
`vp run <task>` anywhere `vpr <task>` is shown.

### `bun` not found

Only needed for `bun run sync:repos` (vendored-repo sync), not for dev. Install
with `sudo pacman -S bun` if you need it.

### Wrong Node version

Vite+ bundles its own Node runtime for tasks, so the system Node version usually
doesn't matter. If a script explicitly needs system Node, the repo targets
`node ^24.13.1`; manage it with fnm/mise.

## Dependencies / native modules

### Missing `node_modules`

```bash
cd ~/Code/t3code && vp i
```

The launchers warn (they don't auto-install) so you get a clear message instead
of a cryptic failure.

### Native dependency / `node-pty` build failure

Ensure build tooling and Electron libs are present:

```bash
sudo pacman -S --needed base-devel python
sudo pacman -S --needed gtk3 nss alsa-lib libxss libnotify libsecret at-spi2-core mesa
```

Then reinstall dependencies (see "reset" below).

## Desktop / Wayland

### Desktop window doesn't open

- Check the konsole/terminal output — the dev server or Electron error is shown
  there (the KDE launcher uses `--hold` so the window stays open).
- Confirm the Electron runtime is present; the first run fetches it. If it
  seems stuck, run the desktop smoke test: `t3b-check --desktop`.

### Wayland rendering glitches

The app runs natively under Wayland with no forced flags. If you see rendering
issues, try (opt-in, temporary) Electron Ozone flags — do **not** commit these
into the launcher:

```bash
# via extra args passed through the wrapper:
t3b-desktop -- --ozone-platform-hint=auto
# or force Wayland / X11 explicitly to compare:
ELECTRON_OZONE_PLATFORM_HINT=wayland t3b-desktop
ELECTRON_OZONE_PLATFORM_HINT=x11 t3b-desktop
```

If a specific flag proves necessary on this hardware, record it in
`~/.config/t3code-blazenetic/env` and note it in ARCHITECTURE-NOTES.md rather
than hard-coding it.

### Port already in use

Another dev server is still running. Find and stop it:

```bash
# example for a Vite default port; adjust to the port vp printed:
ss -ltnp | grep -E ':(5173|3000)'
```

Or ensure previous runs were stopped cleanly (Ctrl-C in the launcher terminal;
the wrapper tears down its whole process group).

### Stale development process / orphans

`t3b-desktop` runs the dev command in its own process group and kills the group
on Ctrl-C, so orphans should not occur. If one lingers:

```bash
pkill -f 'dev-runner.ts dev:desktop' || true
pkill -f electron || true      # be careful if you run other Electron apps
```

## Providers

### Provider CLI unavailable / not authenticated

`t3b-doctor` lists which of codex/claude/opencode/cursor are present. Authenticate
per provider (`codex`, `claude` → `/login`, `opencode auth login`, Cursor GUI).
Tokens are never printed by any t3b tool.

## Git

### Working tree dirty during sync

`t3b-sync` refuses to run. Commit or stash:

```bash
git -C ~/Code/t3code stash          # or commit
t3b-sync
git -C ~/Code/t3code stash pop
```

### Rebase conflict during sync

Follow the recovery steps `t3b-sync` prints (also in
[UPSTREAM-SYNC.md](UPSTREAM-SYNC.md)). Your pre-sync state is on a `backup/...`
branch.

### Accidental commit on `main`

`main` must stay a clean upstream mirror. Move the commit(s) to `blazenetic`:

```bash
cd ~/Code/t3code
git switch blazenetic
git cherry-pick <commit>            # bring it onto blazenetic
git switch main
git reset --hard origin/main        # or upstream/main
```

### Local `main` diverged from upstream

```bash
git -C ~/Code/t3code fetch upstream
git -C ~/Code/t3code switch main
git -C ~/Code/t3code merge --ff-only upstream/main   # if this fails, main has stray commits
```

If ff-only fails, `main` has commits that don't belong there — move them to
`blazenetic` (as above), then re-align.

## Local integration

### Wrapper missing from PATH

Ensure `~/.local/bin` is on PATH (add to `~/.zshrc`):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then re-open your shell. `t3b-doctor` reports PATH status.

### Desktop entry missing from KDE menu

```bash
scripts/blazenetic/install-local-tools.sh
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

Log out/in or restart plasmashell if KDE hasn't picked it up.

### Broken symlink after moving the repo

The wrappers are symlinks into the repo. If you move the clone, re-run:

```bash
scripts/blazenetic/install-local-tools.sh
```

and update `T3B_REPO` (in `~/.config/t3code-blazenetic/env`) if the path changed.

## Reset / clean rebuild

### Reinstall dependencies

```bash
cd ~/Code/t3code
rm -rf node_modules
vp i
```

### Full clean (repository's own clean)

```bash
cd ~/Code/t3code
vp run clean        # removes node_modules/dist/.vite-plus build dirs
vp i
```
