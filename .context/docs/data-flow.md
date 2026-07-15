---
type: doc
name: data-flow
description: Shell and desktop notification data flow for issue #780
category: data-flow
generated: "2026-07-15"
status: filled
scaffoldVersion: "2.0.0"
---

# Data flow

1. Server projector reduces provider events into `OrchestrationThreadShell` records.
2. Client runtime hydrates a cached/base snapshot, subscribes after its sequence, then applies sequenced stream events.
3. Web state exposes environment-scoped thread shells and connection/synchronization status.
4. A pure tracker baselines non-live input and compares live shell observations with the previous accepted state.
5. A derived generic event crosses the preload bridge with kind, stable event ID, environment ID, and thread ID only.
6. Electron rechecks opt-in, native support, deduplication, and whether the main window is focused.
7. Electron shows a silent native notification with fixed generic copy.
8. A click stores the target, restores or creates the main window, focuses the app, and signals the renderer.
9. The renderer consumes the pending target and navigates to `/$environmentId/$threadId`.

The initial snapshot and every reconnect/reseed form a new baseline. Archived records are ignored and removed records cannot generate events.
