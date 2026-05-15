# T3work Additive Whitelist Draft

This whitelist supports the additive guard in `.t3work-additive-guard.json`.

Guard runner: `t3work-additive-guard.mjs`

Prefix policy:

- New additive files may use either `t3work-` or `t3work.` prefixes.
- Route files use dot-separated TanStack route names and are valid additive files.

## Allowed Modified Upstream Files

- `AGENTS.md`
  - Update project constitution reference from project-shell to t3work docs.
- `package.json`
  - Add `lint:t3work:additive` guard script entry.
- `apps/server/package.json`
  - Add `t3work` bin and `dev:t3work` / `start:t3work` scripts.
- `apps/server/src/server.ts`
  - Mount `/api/t3work/atlassian/*` routes in the main server so migrated `/t3work` UI sign-in does not 404.
- `apps/server/tsdown.config.ts`
  - Bundle `src/t3work-bin.ts` alongside existing server bin.
- `apps/web/package.json`
  - Add migrated t3work dependencies used by the main app route.
- `apps/web/vite.config.ts`
  - Add dev proxy/defaults and compile-time constants used by migrated t3work route.
- `apps/web/src/routeTree.gen.ts`
  - Generated TanStack route tree update after adding `/t3work` route.
- `apps/web/src/routes/__root.tsx`
  - Register global t3work route shell entrypoint in root routing tree.
- `packages/t3-adapter/src/workspace.ts`
  - Move managed workspace default path from `project-shell` to `t3work`.
- `bun.lock`
  - Lockfile drift due workspace/package updates.

## Rules

- Keep this list minimal.
- Any new entry requires a one-line reason in this document.
- Prefer additive `t3work-*` or `t3work.*` files over editing upstream files.
- Remove entries when no longer needed.
