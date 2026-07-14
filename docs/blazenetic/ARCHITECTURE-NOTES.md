# Architecture Notes

Downstream-maintenance notes for the Blazenetic fork. This does **not** duplicate
the full upstream architecture — only what a maintainer (human or agent) needs to
operate and extend this setup.

## Baseline (captured at implementation time)

- **Fork:** `Blazenetic/t3code`; **upstream:** `pingdotgg/t3code`.
- The fork was set up by a **fresh clone** into `~/Code/t3code`; at that point
  `origin/main` was a strict ancestor of `upstream/main` (2 commits behind, 0
  ahead) — i.e. a clean mirror, no fork-specific commits. `blazenetic` was
  created from `main`.
- **Task runner:** Vite+ (`vp`) v0.2.x, installed at `~/.vite-plus/` and
  bundling its own Node.js runtime. Repo pins `vite-plus` via the pnpm catalog.
- **Package manager metadata:** `pnpm@11.x` (`packageManager` field); `bun` is a
  runtime/tool dependency used only for `bun run sync:repos`. `turbo` is not used.
- **Node:** repo requires `node ^24.13.1` (`engines`); CI reads it from
  `package.json`.
- **Host:** CachyOS, KDE Plasma, Wayland.

## Package map

pnpm workspace: `apps/*`, `packages/*`, `infra/*`, `scripts`, `oxlint-plugin-t3code`.

- `apps/{server,web,desktop,mobile,marketing}`
- `packages/{contracts,shared,client-runtime,effect-acp,effect-codex-app-server,ssh,tailscale}`

See [CUSTOMISATION-GUIDE.md](CUSTOMISATION-GUIDE.md) for per-package roles.

## Downstream extension locations

- Wrappers & installer: `scripts/blazenetic/`
- Docs: `docs/blazenetic/`
- KDE launcher template: `packaging/linux/t3code-blazenetic-dev.desktop`
- Wrapper config example: `.env.blazenetic.example`
- PR template: `.github/PULL_REQUEST_TEMPLATE/downstream-change.md`

Everything above is **additive** and Low conflict-risk. No upstream source files
were modified by this setup.

## Launcher flow

```
KDE menu entry  ->  konsole --hold -e zsh -lc  ->  ~/.local/bin/t3b-desktop
                                                        │ (symlink)
                                                        ▼
                                      scripts/blazenetic/t3b-desktop
                                                        │
                                        source lib/common.sh; resolve repo;
                                        ensure vp; set -m; `vp run dev:desktop`
                                        in its own process group; trap signals
```

`~/.local/bin/t3b*` are **symlinks** into the repo, so editing a wrapper takes
effect immediately (no reinstall). The KDE entry runs a **login shell** so `vp`
resolves on PATH even though system Node comes from an ephemeral fnm path.

## Environment assumptions

- `vp` on PATH (or at `~/.vite-plus/bin`). `common.sh::ensure_vp` adds the
  latter as a fallback and otherwise prints the install command.
- `~/.local/bin` on PATH (already true on this host).
- `node_modules` present (`vp i`). Launchers warn, they do not auto-install.
- Wrapper config auto-loaded, if present, from
  `~/.config/t3code-blazenetic/env` and `<repo>/.env.blazenetic`.

## Git maintenance model

`main` = clean upstream mirror; `blazenetic` = customisations; feature branches
off `blazenetic`. Upstream integration via `t3b-sync` (rebase default, `--merge`
optional), which always leaves a `backup/...` ref and never auto-pushes. See
[UPSTREAM-SYNC.md](UPSTREAM-SYNC.md).

## Decisions (ADRs)

### Decision: run the live working tree during development

**Context.** Rebuilding and reinstalling an Arch/AUR package (or AppImage) after
each source change is far too slow for iteration.

**Decision.** Use the repository's native dev commands (`vp run dev*`) launched
through global, symlinked wrappers (`t3b*`).

**Consequences.**

- Edits are reflected through the dev server / hot reload.
- No repeated AUR/AppImage packaging during development.
- A terminal-backed dev process stays running (visible logs, Ctrl-C to stop).
- Release packaging (`vp run dist:desktop:linux`) remains a separate, explicit
  operation.

### Decision: standalone Bash wrappers, not root `package.json` scripts

**Context.** Root `package.json` is highly conflict-prone on rebases.

**Decision.** Ship downstream entry points as standalone Bash scripts under
`scripts/blazenetic/` rather than adding `blazenetic:*` scripts to the root
`package.json`.

**Consequences.** Zero conflict surface on the most-edited upstream file; the
tooling is self-contained and discoverable in one directory.

### Decision: keep `origin` on HTTPS

**Context.** The clone uses HTTPS; SSH needs user-managed keys.

**Decision.** Leave `origin` on HTTPS; document the optional SSH switch.

**Consequences.** Fetch works out of the box; pushing uses the user's existing
GitHub credential helper (or they switch to SSH when convenient).

## Known risks

- Vite+ is a fast-moving external toolchain; command names should be re-verified
  against `README.md` / `AGENTS.md` / CI after large upstream bumps.
- System Node comes from fnm via an ephemeral path; non-login contexts must rely
  on vp's bundled runtime or a login shell (the launcher does the latter).
- Electron-under-Wayland may occasionally need opt-in flags — see
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md); none are hard-coded.

## Future customisation candidates

See the "Good first customisations" list in
[CUSTOMISATION-GUIDE.md](CUSTOMISATION-GUIDE.md).
