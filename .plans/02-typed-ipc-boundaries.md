# Typed Desktop IPC Boundaries

Status: **Completed**
Last reviewed: 2026-07-13

## Original intent

Replace unchecked Electron IPC payload casts with validated, typed handlers.

## Current state

Desktop IPC is organized under `apps/desktop/src/ipc`:

- `DesktopIpc.ts` owns registration and request execution.
- `DesktopIpcHandlers.ts` composes handler layers.
- `channels.ts` defines channel metadata.
- `methods/` contains narrow domain handlers and colocated tests.

Payloads are Effect Schema values decoded at the boundary. Shared transport shapes live in `packages/contracts`; runtime behavior stays in the desktop app or a runtime package.

## Maintenance rules

- Treat renderer input as `unknown` until the channel schema decodes it.
- Return typed errors; do not restore `as Parameters<...>` casts.
- Keep method modules domain-sized and test invalid payloads as well as success paths.
- Prefer the same schema for preload, main-process, and test fixtures.

## Validation

Run affected `apps/desktop/src/ipc/**/*.test.ts` tests with `vp test`, then the repository baseline.
