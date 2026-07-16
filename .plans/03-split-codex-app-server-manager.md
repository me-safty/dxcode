# Codex Runtime Decomposition

Status: **Completed and superseded by the provider architecture**
Last reviewed: 2026-07-13

## Original intent

Split a desktop-owned `CodexAppServerManager` that mixed process lifecycle, JSON-RPC, sessions, and events.

## Current state

Codex is no longer owned by the Electron main process:

- `packages/effect-codex-app-server` owns the typed Codex app-server protocol client.
- `apps/server/src/provider/Layers/CodexAdapter.ts` translates Codex behavior into provider-neutral runtime events.
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts` owns live Codex session runtime state.
- `apps/server/src/provider/Layers/ProviderService.ts` is the provider-neutral facade.
- `apps/server/src/orchestration` persists and projects user-visible state.

Effect scopes, typed errors, and adapter-local tests now provide the lifecycle boundaries the old class split was trying to create.

## Maintenance rules

- Keep raw Codex JSON-RPC types and ordering inside the protocol package or Codex adapter.
- Do not add Codex branches to provider-neutral orchestration.
- Use scoped resources and finalizers for subprocesses, subscriptions, and pending requests.

## Validation

Run the protocol-package and Codex adapter tests with `vp test`, then the repository baseline.
