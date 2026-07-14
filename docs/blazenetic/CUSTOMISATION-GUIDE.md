# Customisation Guide

How to make Blazenetic-specific changes that survive upstream rebases with the
least friction.

## Design rules

- **Isolate branding and downstream-only code.** Prefer new files under
  `scripts/blazenetic/`, `docs/blazenetic/`, `packaging/linux/`, or clearly
  scoped new modules, over edits scattered across upstream files.
- **Centralise downstream configuration** rather than sprinkling constants.
- **Don't edit generated files.** They are re-generated and your edits will be
  lost or will conflict.
- **Prefer extension points** (config, plugins, new routes/components) over
  modifying core orchestration.
- **Understand upstream architecture before broad UI rewrites.** Small,
  reversible changes first.
- **Retain package boundaries** — don't collapse the monorepo's separation.
- **Document intentional departures** from upstream in
  [ARCHITECTURE-NOTES.md](ARCHITECTURE-NOTES.md).
- **Mark downstream-only files** unobtrusively (a header comment, or living
  under a `blazenetic/` path) so future maintainers can identify them.
- **Keep commits small and coherent** so they replay cleanly during difficult
  rebases.

## Package roles (from `AGENTS.md`)

The repo is a pnpm-workspace monorepo. Key packages:

| Package                                                              | Role                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/server`                                                        | Node WebSocket server wrapping the Codex app-server               |
| `apps/web`                                                           | React/Vite web UI                                                 |
| `apps/desktop`                                                       | Electron desktop shell (`@t3tools/desktop`)                       |
| `apps/mobile`                                                        | Mobile app (native lint via `vp run lint:mobile`)                 |
| `apps/marketing`                                                     | Marketing site                                                    |
| `packages/contracts`                                                 | effect/Schema schemas (schema-only)                               |
| `packages/shared`                                                    | Runtime utilities with subpath exports                            |
| `packages/client-runtime`                                            | Shared client code for web + mobile                               |
| `packages/effect-acp`, `effect-codex-app-server`, `ssh`, `tailscale` | Supporting runtime packages                                       |
| `scripts/`                                                           | Repo automation (`dev-runner.ts`, `build-desktop-artifact.ts`, …) |

Desktop dev and packaging are driven from the **root** scripts
(`scripts/dev-runner.ts`, `scripts/build-desktop-artifact.ts`), not from inside
`apps/desktop`.

## Conflict-risk classification

Use this to judge (and label in PRs) how likely a change is to conflict with
upstream during a rebase:

- **Low** — docs, wrappers, local scripts, new isolated assets, `packaging/`.
  _(Everything this downstream tooling adds is Low.)_
- **Medium** — configuration changes, additional routes/components, new provider
  integrations, additive changes to `apps/web`.
- **High** — shared contracts (`packages/contracts`), core orchestration, the
  state model, desktop lifecycle (`apps/desktop` main/preload), server protocol
  handling.
- **Very high** — package-manager or workspace structure, repository layout,
  generated protocol layers, anything touching `pnpm-workspace.yaml` /
  `package.json` engines/catalog.

Prefer Low/Medium changes. When a High/Very-high change is unavoidable, keep it
in the smallest possible commit, document the rationale, and expect to
re-resolve it on future syncs.

## Good first customisations (low conflict)

1. **Branding assets** applied via the repo's own brand mechanism (see
   `scripts/apply-web-brand-assets.ts`) — additive, isolated.
2. **A downstream landing/README or docs** under `docs/blazenetic/`.
3. **Isolated configuration** loaded through the existing config system rather
   than hard-coded edits to upstream source.
