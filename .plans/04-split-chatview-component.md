# Decompose `ChatView` Along Current Runtime Boundaries

Status: **Active**
Last reviewed: 2026-07-13

## Goal

Reduce `apps/web/src/components/ChatView.tsx` from a multi-thousand-line coordinator into a route-level container whose dependencies and failure behavior are easy to test. Preserve current UX, stream ordering, draft persistence, terminal recovery, and mobile/desktop parity.

## Current state

The first decomposition already happened. Presentation and pure logic now exist in:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/ChatView.logic.ts`
- focused `components/chat/*` panels, pickers, and tests

`ChatView.tsx` still owns too much coordination, especially persistent terminal drawer/panel behavior, orchestration-derived command state, composer submission, environment availability, and cross-panel effects.

## Implementation phases

1. **Characterize behavior first**
   - Add or strengthen tests around terminal attach/restart, draft-to-thread handoff, send/interrupt/retry, reconnect recovery, plan follow-up, and focus/scroll behavior.
   - Prefer semantic assertions over DOM geometry.
2. **Extract terminal presentation ownership**
   - Move `PersistentThreadTerminalDrawer` and `PersistentThreadTerminalPanel` into `components/chat/terminal/`.
   - Keep terminal session state in `packages/client-runtime`/`apps/web/src/state`; extracted components should receive narrow IDs and callbacks.
3. **Extract composer orchestration**
   - Introduce a focused hook/module for send, interrupt, retry, provider selection, and draft-thread promotion.
   - Keep durable mutations routed through existing client-runtime commands and RPC atoms.
4. **Extract environment and availability derivation**
   - Move environment-offline, auth, provider, and branch/worktree readiness derivation into pure selectors with table-driven tests.
5. **Shrink the container**
   - Leave route/thread selection, high-level layout, and explicit composition in `ChatView.tsx`.
   - Remove compatibility props and duplicate local state only after all callers have moved.

Each phase must be independently reviewable and green. Avoid a file-move-only mega-PR or a new facade that recreates `ChatView` elsewhere.

## Acceptance criteria

- `ChatView.tsx` is materially smaller and reads as composition rather than implementation.
- Terminal, composer, and environment logic have narrow public interfaces and direct regression tests.
- No new global store is introduced for component-local state.
- Reconnects, partial streams, session restarts, and failed terminal operations remain predictable.
- The repository baseline passes after every phase.
