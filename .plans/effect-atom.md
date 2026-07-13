# Effect Atom RPC and Client State

Status: **Completed**
Last reviewed: 2026-07-13

## Outcome

The old React Query and imperative `NativeApi`/`wsNativeApi` facades are gone. Current client state is layered as follows:

- `packages/client-runtime/src/rpc` owns typed cross-client RPC protocol/session/client behavior.
- `packages/client-runtime/src/state` owns reusable Atom-backed server, orchestration, VCS, source-control, auth, terminal, and project state.
- `apps/web/src/rpc/atomRegistry.ts` composes the web registry.
- `apps/web/src/state` provides web-facing hooks and actions.
- Zustand remains for genuinely local UI/draft state, not server data fetching.
- Electron-only capabilities use the narrow preload `desktopBridge` boundary.

## Invariants

- Components consume domain hooks/actions rather than raw RPC clients.
- Cache keys and invalidation stay scoped by environment and entity identity.
- Mutations expose pending/error state and refresh only affected domains.
- Snapshot hydration and incremental streams cannot cross-contaminate environments.
- Reconnect behavior is centralized in client-runtime, with deterministic tests.
- Do not reintroduce React Query or a mega-facade for server features.
- Browser/desktop-specific behavior stays out of shared client-runtime modules.

## Validation

Run the affected client-runtime and web state tests with `vp test`, use `vp run test` for RPC contract changes, then run the repository baseline.
