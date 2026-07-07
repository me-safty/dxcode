# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

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

## Cursor Cloud specific instructions

Toolchain is pre-installed and wired into login shells (`~/.bashrc`/`~/.profile`): Node 24 (via nvm),
the global `vp` (Vite+) CLI, and its bundled pnpm. `vp` is the package manager + task runner for this
repo (`vp i`, `vp check`, `vp run typecheck`, `vp test`, `vp run --filter <pkg> <script>`).

- Node gotcha: the base image also ships an older Node on `/exec-daemon` that wins on `PATH` in
  non-login shells. Run commands in a login shell (`bash -lc '...'`) or prepend
  `$HOME/.nvm/versions/node/v24.13.1/bin` so Node 24 (`engines.node: ^24.13.1`) is used.
- Run the app in dev: `npm run dev` (from repo root) starts contracts (watch) + web (Vite, port 5733)
  + server (`node --watch`, port 13773) together, auto-wiring `VITE_HTTP_URL`/`VITE_WS_URL`. Use
  `npm run dev:server` / `npm run dev:web` for one side. If base ports are taken it auto-offsets to the
  next free pair, so read the actual ports from stdout. Avoid production `build`/`start` in dev.
- Auth/pairing: the server is unauthenticated by default and prints a pairing URL to stdout on startup
  (e.g. `http://localhost:5733/pair#token=XXXX`). Open that URL in the browser to pair before the web
  UI can talk to the server. Server state (SQLite, auth, projects) lives under `~/.t3` (`T3CODE_HOME`);
  multiple `npm run dev` instances bind different ports but share that same DB.
- Agent providers are external CLIs (`codex`, `claude`, `cursor-agent`, `opencode`) probed on `PATH`.
  Without one installed the UI loads but no agent can run. Claude Code
  (`npm i -g @anthropic-ai/claude-code`) works headlessly using `ANTHROPIC_API_KEY` from the
  environment (the server forwards `process.env` to the child; no interactive `claude auth login`
  needed). Provider probing runs at startup and refreshes roughly every 5 minutes — restart the dev
  server to pick up a newly installed provider CLI immediately.
- Known pre-existing flaky tests (unrelated to setup): `apps/server/src/git/GitManager.test.ts`
  (cross-repo PR metadata, can time out at 12s) and
  `apps/server/src/provider/Layers/ProviderRegistry.test.ts` (codex binaryPath re-probe ordering).
