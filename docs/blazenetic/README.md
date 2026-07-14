# T3 Code — Blazenetic Downstream Development

This directory documents the **Blazenetic downstream fork** of
[T3 Code](https://github.com/pingdotgg/t3code) and its local development
environment on CachyOS + KDE Plasma + Wayland.

The goal: keep a clean relationship with upstream, keep our customisations
isolated on a long-lived branch, and **run the app straight from the live source
tree** — so ordinary edits never require rebuilding or reinstalling an AUR/AppImage
package.

> **Dev mode vs packaged release.** The `t3b*` launchers below run the **live
> working tree** via the repository's dev server / hot reload. Building a
> distributable Linux artefact (`vp run dist:desktop:linux`, an AppImage) is a
> separate, explicit operation you do only when you want a stable package — not
> after every source edit. See [DAILY-WORKFLOW.md](DAILY-WORKFLOW.md).

## Repository model

| Concept      | Meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `origin`     | The fork — `https://github.com/Blazenetic/t3code`           |
| `upstream`   | Canonical — `https://github.com/pingdotgg/t3code`           |
| `main`       | Clean mirror of `upstream/main` — **no** Blazenetic commits |
| `blazenetic` | Long-lived branch holding all downstream customisations     |

Feature work branches off `blazenetic` as `feature/*`, `fix/*`, `chore/*` and
merges back. See [UPSTREAM-SYNC.md](UPSTREAM-SYNC.md) for how upstream changes
flow in, and [CUSTOMISATION-GUIDE.md](CUSTOMISATION-GUIDE.md) for how to keep
customisations low-conflict.

## Quick start

```bash
# 1. Clone the fork and add upstream (once):
git clone https://github.com/Blazenetic/t3code ~/Code/t3code
cd ~/Code/t3code
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
git branch blazenetic main        # create the downstream branch

# 2. Install the mandated task runner (Vite+) — once, system-wide:
curl -fsSL https://vite.plus | bash    # restart your shell afterwards

# 3. Install dependencies:
vp i

# 4. Install the t3b* wrappers + KDE launcher (symlinks; edits apply instantly):
scripts/blazenetic/install-local-tools.sh --doctor

# 5. Launch the desktop app from the live tree:
t3b-desktop
```

Full, copy-pasteable setup: [SETUP-CACHYOS.md](SETUP-CACHYOS.md).

## Commands

| Command       | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `t3b`         | Run the complete dev environment (`vp run dev`)                      |
| `t3b-web`     | Run web dev mode (`vp run dev:web`)                                  |
| `t3b-desktop` | Run the Electron desktop app from live source (`vp run dev:desktop`) |
| `t3b-check`   | Validate changes (`--quick`, `--desktop`, `--full`)                  |
| `t3b-sync`    | Safely integrate upstream changes                                    |
| `t3b-doctor`  | Diagnose the environment (read-only)                                 |
| `t3b-shell`   | Enter a shell rooted in the repo                                     |

All wrappers are symlinks into `~/.local/bin` pointing at
`scripts/blazenetic/`, so editing a wrapper takes effect immediately with no
reinstall.

## Documents

- [SETUP-CACHYOS.md](SETUP-CACHYOS.md) — full first-time setup on CachyOS
- [DAILY-WORKFLOW.md](DAILY-WORKFLOW.md) — start / edit / finish / package
- [UPSTREAM-SYNC.md](UPSTREAM-SYNC.md) — keeping `main` clean, `t3b-sync`, recovery
- [CUSTOMISATION-GUIDE.md](CUSTOMISATION-GUIDE.md) — downstream design rules + conflict risk
- [ARCHITECTURE-NOTES.md](ARCHITECTURE-NOTES.md) — package map, decisions, ADRs
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — vp / Bun / native modules / Wayland / git

## Conventions

- The mandated task interface is **Vite+ (`vp` / `vp run` / `vpr`)**. `bun` is a
  runtime/tool dependency used only for `bun run sync:repos`; do **not** use
  `bun run`, `pnpm`, or `npm` as the task interface.
- Everything downstream lives under `scripts/blazenetic/` and `docs/blazenetic/`
  (plus `packaging/linux/` and a couple of root example files) to minimise
  conflicts with upstream.
