# SP-B / B3 — Port the board UI into the plugin web bundle

**Status:** B1 (SDK gaps) + B2 (data layer) DONE + committed + typecheck-green. Plumbing
verified live end-to-end. B3 (this doc) = the mechanical 58-file UI port. B4 = live E2E verify.

**Goal:** Move the fork's board UI (`~/Developer/t3code` on `ft/hyperion`, 17,470 LOC / 58 files)
into `fixtures/workflow-boards/web/`, rewire imports, register the route + sidebar, build.

---

## Source (fork) → destination (plugin) file map

Fork root `apps/web/src`; plugin root `fixtures/workflow-boards/web`.

- `workflow/*.ts` → `web/workflow/*.ts` — EXCEPT these (already replaced in B2, do NOT copy):
  - `useWorkflowApi.ts` → replaced by `web/workflowApi.ts` (`createWorkflowApi`)
  - `boardState.ts` (9-line re-export) → replaced by `web/boardState.ts` + `web/useBoardState.ts`
- `state/workflow.ts` (`workflowEnvironment`) → replaced by `web/useBoardState.ts` (folded board) +
  `web/workflowApi.ts` (imperative facade). Do NOT copy.
- `components/board/*.tsx` → `web/components/board/*.tsx`
- `components/board/editor/**` → `web/components/board/editor/**`
- `routes/_chat.$environmentId.board.tsx` → `web/boardRoute.tsx` (adapted: see "Route registration")
- Copy `.test.*` files too (fixture test runner is `vp test run`); skip `__screenshots__/`.

`nextDefaultBoardName` (from fork `components/Sidebar.logic.ts:260`) is board-domain and NOT in the
worktree host → copy that ONE function into `web/boardLocalUtils.ts` and import it there.

## Import rewrite rules (apply to every copied file)

Host surface → **`@t3tools/plugin-sdk-web`** (all already re-exported by B1; multiple import
statements from the SDK in one file are fine):
- `~/components/ui/*`
- `~/components/chat/ProviderModelPicker`, `~/components/chat/TraitsPicker`, `~/components/chat/DiffStatLabel`
- `~/components/ChatMarkdown`
- `~/lib/utils` (cn, randomUUID), `~/lib/diffRendering`
- `~/hooks/useSettings` (usePrimarySettings), `~/hooks/useTheme` (useTheme)
- `~/session-logic` (formatDuration), `~/state/server` (primaryServerProvidersAtom)
- `~/providerInstances`, `~/modelSelection`
- `@pierre/diffs/react` `FileDiff` → `@t3tools/plugin-sdk-web` (B1 re-exports it)

Plugin-local (relative paths — script them with `node path.relative`, they vary by file depth):
- `~/workflow/X` → relative to `web/workflow/X`
- `~/components/board/X` → relative to `web/components/board/X`
- `~/workflow/useWorkflowApi` → `web/workflowApi` (`useWorkflowApi` shim, see below)
- `~/state/workflow` (`workflowEnvironment`) + `~/workflow/boardState` → `web/useBoardState` + `web/boardState`
- `~/components/Sidebar.logic` (`nextDefaultBoardName`) → `web/boardLocalUtils`

`@t3tools/contracts` — **per-symbol split** (board types were removed from the worktree host and now
live in the fixture). Board-specific types (the 21 set below) → `../contracts/workflow.ts` (or
`outbound.ts` / `workSource.ts`); generic types stay `@t3tools/contracts`:
- BOARD (→ fixture): AutoPullCriteria, BoardId, BoardListEntry, BoardStreamItem, ImportableWorkItemView,
  LaneKey, StepKey, summarizeAutoPull, TicketId, TicketDiff (aliased TicketDiffData), WorkflowBoardDigest,
  WorkflowBoardMetrics, WorkflowDefinition, WorkflowDefinitionEncoded, WorkflowDryRunHop, WorkflowDryRunResult,
  WorkflowLintError, WorkflowSourceConfig, WorkflowTicketArtifact, WorkflowWebhookConfig, WorkSourceProviderName
  (+ the full facade I/O set — all 46 confirmed present in fixture contracts)
  - `outbound.ts`: CreateOutboundConnectionInput, OutboundConnectionView
  - `workSource.ts`: WorkSourceConnectionView, ImportWorkItemsResult, ListImportableWorkItemsResult
- GENERIC (keep `@t3tools/contracts`): EnvironmentApi (see route note), EnvironmentId, ProjectId,
  ProviderInstanceId, ProviderOptionSelection, ScopedProjectRef, MessageId

`@t3tools/client-runtime/*` — 2 leaf files use it (`workflow/boardListState.ts`,
`workflow/resolveRecentAgent.ts`) plus the route (`state/shell`, `state/runtime`, `state/board-state`).
Inspect each: `state/board-state` reducer is already ported (`web/boardState.ts`); `state/runtime`
(executeAtomQuery/runAtomCommand) is available via SDK (`useAtomCommand`/`useAtomQueryRunner`) or
`getConnectionAtomRuntime`; `state/shell` usage TBD per-call. Redirect to SDK/plugin-local equivalents.

`EnvironmentApi["workflow"]` → the plugin-local `WorkflowApi` type from `web/workflowApi.ts`. Grep the
board files for `EnvironmentApi["workflow"]` / `type WorkflowApi =` and repoint to `web/workflowApi`.

## `useWorkflowApi` shim

Board components call `useWorkflowApi(environmentId)`. In the plugin the RPC is the plugin's
`PluginWebRpc` (from the route component's `ctx.rpc` / `PluginRouteComponentProps`), not env-keyed.
Add to `web/workflowApi.ts`:
```ts
export function useWorkflowApi(rpc: PluginWebRpc): WorkflowApi {
  return useMemo(() => createWorkflowApi(rpc), [rpc]);
}
```
The route obtains `rpc` from the plugin route props and prop-drills `api` into the tree (unchanged).

## Board route → plugin route registration

Fork route `_chat.$environmentId.board.tsx` reads `environmentId` from TanStack route params + a
`boardId` search param, calls `useWorkflowApi(environmentId)` + `useEnvironmentQuery(workflowEnvironment.board(...))`.
Adapt into a plugin route component registered via `defineWebPlugin` `registerRoute({ path: "boards", component })`:
- `rpc` ← plugin route props; `api = useWorkflowApi(rpc)`.
- folded board ← `useBoardState(rpc, boardId)` (replaces `useEnvironmentQuery(workflowEnvironment.board(...))`).
- `boardId` selection: plugin routes get `location`/`path` (see Phase-0 fixture `PluginRouteComponentProps`);
  derive `boardId` from a query param or in-plugin state. Board LIST selection may need a small local router.
- Sidebar section (`registerSidebarSection`) lists boards (via `api.listBoards`) linking to
  `${routeBasePath}/boards?board=<id>` — reuse the Phase-0 sidebar pattern (already live-verified).

## Build + tsconfig

- `fixtures/workflow-boards/scripts/build.mjs`: the web esbuild step already externalizes
  `@effect/atom-react`, `@t3tools/plugin-sdk-web`, `effect`, `effect/*`, `react*`. Add any new externals
  only if needed (e.g. keep `@pierre/diffs` OUT — it comes via the SDK). Ensure the entry stays
  `web/index.tsx` and it imports the ported route/sidebar.
- `fixtures/workflow-boards/tsconfig.json`: already has DOM lib + react-jsx + `~/*`→apps/web paths (for
  the SDK's apps/web re-exports). The copied board files must NOT rely on `~/*`→apps/web (that would pull
  host copies) — they use rewritten imports, so this is fine. Add `web/**/*.tsx` is already included.
- Verify: `pnpm --filter @t3tools/fixture-workflow-boards run typecheck` (tsgo) → 0 errors.

## Verification (B4)

Reuse the live harness proven this session:
1. `pnpm --filter @t3tools/web exec vp build` (static web).
2. `node apps/server/src/bin.ts start <proj> --auto-bootstrap-project-from-cwd --base-dir <isoHome> --port 13902 --no-browser` with `T3_PLUGIN_DEV=1`.
3. Install+activate the rebuilt fixture tarball (or hot-swap the extracted `web/` dir), fresh Chrome
   `--remote-debugging-port=9222` at the pair URL.
4. Drive over CDP (clear cache before reload — versioned plugin asset path caches): navigate to
   `/<env>/p/workflow-boards/boards`, assert the real board renders, create a board, open a ticket
   drawer, edit the workflow definition, confirm live `subscribeBoard` updates.
5. Gates: fixture typecheck, web+server typecheck, `plugins.test.ts`, `plugin-sdk-web` test.

## Known risks / watch-items

- `FileDiff` (TicketDiff) needs the host's `DiffWorkerPoolProvider` mounted around the app; if the plugin
  route isn't inside it, ticket diffs won't render — degrade gracefully or confirm the provider wraps
  `PluginUiHost`. (Low priority — one component.)
- Plugin routes don't yet receive project/environment context beyond `location` — board-list needs a
  `projectId` for `listBoards`. Derive from the route env segment (`/<env>/p/...`) or add context to
  `PluginRouteComponentProps` (host change). This is the main open design point for the route.
- Tailwind: plugin ships no compiled CSS; the board UI uses host utility classes + CSS vars. The host
  build scans host source only, so classes used ONLY by the plugin won't be emitted. Board UI mostly
  reuses host components (which carry their classes) — spot-check after first render.
