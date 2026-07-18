# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Repository Hierarchy

This repository is the separate DX Code product repository, not the canonical T3 Code repository and not
necessarily a GitHub fork. Git remotes and branches define the relationship:

- `origin`: the DX Code repository (`me-safty/dxcode`). DX branches and releases belong here.
- `upstream`: canonical T3 Code (`pingdotgg/t3code`). Treat it as read-only.
- Optional contribution fork: use only for pull requests back to canonical T3 Code.

Do not use or create a `master` workflow. Use these branch roles:

- `upstream/main`: untouched canonical T3 history and source for production T3 builds.
- `dx/main`: long-lived DX integration and release branch.
- `feature/*`: short-lived DX features based on `dx/main`.
- `sync/upstream-YYYY-MM-DD`: temporary upstream merge branches based on `dx/main`.

Never add DX product work to `upstream/main`, a local mirror of it, or an upstream-sync commit. Generic
changes intended for canonical T3 must start from `upstream/main` and use the optional contribution fork.

## Feature Workflow

Start new DX features from current `dx/main`, never from an old feature branch unless the work is explicitly
stacked:

```bash
git fetch origin upstream
git switch dx/main
git pull --ff-only origin dx/main
git switch -c feature/<name>
```

Keep product features behind domain seams such as `apps/web/src/features/<name>/`. Do not put product
behavior in desktop flavor modules. Flavor modules own only app identity, protocols, branding, state paths,
packaging, and update policy.

Review fixes belong on the same `feature/*` branch. Push new commits to update its PR. Before integration,
merge current `dx/main` into the feature and run required checks. PRs for DX features target `dx/main`.
After merge, create unrelated work from `dx/main`, not the completed feature branch.

For unpublished personal branches, rebasing is acceptable. For shared branches, prefer merges. Preserve real
merge ancestry for all upstream synchronization work.

## Worktree Ownership

Keep the primary durable workspace on `dx/main`. Give each feature and upstream sync its own worktree. Use
durable sibling directories for ongoing work; `/private/tmp` worktrees are disposable and may vanish after a
restart.

```bash
git worktree add ../t3code-worktrees/<name> -b feature/<name> dx/main
```

Do not edit another active worktree's branch or remove a worktree containing uncommitted changes. After a
feature is integrated, remove its clean worktree and delete its merged branch.

## Desktop Build Sources

- Production T3 Code: build from a clean `upstream/main` worktree with `bun run dist:desktop:dmg`.
- Live development: run from the active feature worktree with `bun run dev:desktop`.
- Packaged DX Code: build only from `dx/main` with `bun run dist:desktop:dx:dmg`.

The three instances must retain distinct bundle IDs, URL schemes, Electron user-data names, and server state
roots. Production uses `~/.t3/userdata`, live development uses `~/.t3/dev`, and DX uses `~/.t3/dx`. Never
introduce a migration or fallback that lets development or DX silently reuse production state.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
