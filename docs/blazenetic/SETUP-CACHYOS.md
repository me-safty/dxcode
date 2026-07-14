# Setup — CachyOS + KDE Plasma + Wayland

First-time setup for the Blazenetic downstream fork. Commands are
copy-pasteable and assume no particular username or home path.

## 1. Prerequisites (host packages)

The core toolchain (`git`, `curl`, `python`, `base-devel`) is standard on
CachyOS. Vite+ bundles its own Node.js runtime, so you do **not** need to
install Node/npm just to run the tasks.

```bash
sudo pacman -S --needed base-devel git curl python
```

The Electron desktop app needs these runtime libraries. On a typical CachyOS +
KDE install they are already present; install any that are missing:

```bash
sudo pacman -S --needed \
  gtk3 nss alsa-lib libxss libnotify libsecret xdg-utils at-spi2-core mesa
```

Optional but recommended: `konsole` (KDE default terminal, used by the launcher)
and `shellcheck` (to lint the wrapper scripts).

## 2. Clone the fork

```bash
git clone https://github.com/Blazenetic/t3code ~/Code/t3code
cd ~/Code/t3code
```

If you keep the repo elsewhere, set `T3B_REPO` (see step 8).

## 3. Remotes

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
git remote -v      # origin -> Blazenetic/t3code, upstream -> pingdotgg/t3code
```

> Optional: switch `origin` to SSH if you have keys configured:
> `git remote set-url origin git@github.com:Blazenetic/t3code.git`

## 4. Branches

`main` mirrors upstream; `blazenetic` holds your customisations.

```bash
git branch blazenetic main   # create the downstream branch from main
git switch blazenetic
```

## 5. Install Vite+ (`vp`) — the mandated task runner

```bash
curl -fsSL https://vite.plus | bash
```

This installs `vp` into `~/.vite-plus/` and updates your shell rc files
(zsh/bash/fish). **Restart your shell**, then verify:

```bash
vp --version        # e.g. vp v0.2.4
```

`vp run` is also available as the standalone alias `vpr` (a shell function/
completion set up by the installer). The wrapper scripts use `vp run` directly
so they work regardless.

## 6. Install dependencies

```bash
cd ~/Code/t3code
vp i
```

This populates `node_modules/` (a large monorepo — allow a few minutes and a
few GB). The first desktop launch also fetches the Electron runtime.

## 7. Provider CLIs (optional)

T3 Code integrates external coding-agent providers. Install/authenticate only
the ones you use — none are installed automatically:

- **Codex** — see the official Codex CLI install docs; then run `codex` to log in.
- **Claude Code** — `claude` then `/login`.
- **OpenCode** — `opencode auth login`.
- **Cursor** — Cursor GUI login.

`t3b-doctor` reports which are present (it never prints tokens).

## 8. Install the local tools

```bash
scripts/blazenetic/install-local-tools.sh --doctor
```

This symlinks the `t3b*` commands into `~/.local/bin` and renders the KDE
launcher into `~/.local/share/applications/`. It is idempotent.

If `~/.local/bin` is not on your `PATH`, the installer prints the exact line to
add to `~/.zshrc` (it never edits shell files for you):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Optional per-clone or user-global configuration:

```bash
cp .env.blazenetic.example ~/.config/t3code-blazenetic/env
# edit T3B_REPO / T3B_BRANCH / T3B_TERMINAL / T3B_DEV_MODE as needed
```

## 9. First launch

```bash
t3b-desktop      # Electron desktop app from the live tree (Ctrl-C to stop)
# or
t3b-web          # web dev server; the URL appears in vp's output
```

## 10. First validation

```bash
t3b-check --quick    # vp check + typecheck (fast)
t3b-check            # + tests
t3b-check --desktop  # + desktop smoke test
```

## 11. KDE launcher

After step 8, **"T3 Code — Blazenetic Dev"** appears in the KDE application
launcher (Development category). It opens konsole running the desktop dev mode
so you can see logs and stop it with Ctrl-C.

## 12. Wayland notes

The desktop app is launched natively under KDE Wayland — no special flags are
forced. If you hit a Wayland-specific rendering issue, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for optional, opt-in Electron overrides.
