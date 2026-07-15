---
type: doc
name: architecture
description: System architecture and package boundaries relevant to issue #780
category: architecture
generated: "2026-07-15"
status: filled
scaffoldVersion: "2.0.0"
---

# Architecture

- `apps/server` owns provider processes, orchestration, and WebSocket delivery.
- `apps/web` owns shell state, thread UI, routing, and client preferences.
- `apps/desktop` owns Electron main-process windows, IPC, persistence, and native OS integration.
- `packages/contracts` is schema-only and defines shared settings and IPC payloads.
- `packages/client-runtime` owns shared client state reduction and shell synchronization.

## Issue #780 boundaries

- Canonical attention state is `OrchestrationThreadShell`: settled `latestTurn`, `hasPendingApprovals`, `hasPendingUserInput`, and `archivedAt`.
- Event derivation stays pure and renderer-side because shell snapshots already combine provider-specific state.
- Focus, native capability, persisted opt-in, deduplication, and notification delivery stay in the Electron main process.
- IPC carries only event kind and opaque environment/thread identifiers. Notification copy is fixed in desktop code and never contains agent output, diffs, commands, or prompts.
- Click navigation uses the existing `/$environmentId/$threadId` route after Electron restores or creates the main window.

## Reliability rules

- Baseline snapshots, reconnects, replays, and reseeds never derive alerts.
- Only a real `running` to settled turn transition alerts; intermediate streamed content does not.
- Rising approval/input flags alert once. Stable state does not repeat.
- Archived or removed threads are suppressed.
- The desktop process rechecks window focus and persisted opt-in immediately before delivery.
