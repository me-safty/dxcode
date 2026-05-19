---
name: t3code-runtime-investigation
description: "Reusable debugging workflow for future T3 Code runtime issues, especially desktop app incidents involving missing thread content, blank thread views, provider/session failures, reconnects, and suspected state desynchronization. Use when the user asks where logs live, whether a thread still exists in state, whether the provider failed or the UI failed, or how to investigate issues from bun dev:desktop. Prefer this skill for forensic investigation before attempting fixes."
---

# T3 Code Runtime Investigation

Use this workflow for future debugging in T3 Code when the app appears to lose state, a thread goes blank, a response seems stuck, or desktop runtime behavior is unclear.

## Primary goals

Determine which layer is actually failing:

- provider/runtime execution
- server projection or persistence
- client store synchronization
- route/render logic

Do not guess from symptoms alone. A blank thread does not imply the provider failed.

## Environment and path model

For desktop development runs started via `bun dev:desktop`:

- Electron `userData` is under `~/Library/Application Support/t3code-dev`
- T3 runtime state is under `~/.t3/dev`
- Logs are under `~/.t3/dev/logs`
- SQLite projection state is `~/.t3/dev/state.sqlite`

Important distinction:

- `~/Library/Application Support/t3code-dev` is not the main place to look for live runtime logs
- `~/.t3/dev/logs` is the main runtime log location for dev desktop incidents

## First-pass investigation workflow

### 1. Confirm the runtime directories

Inspect:

- `~/.t3/dev`
- `~/.t3/dev/logs`

Useful files:

- `~/.t3/dev/state.sqlite`
- `~/.t3/dev/logs/provider/*.log`
- `~/.t3/dev/logs/server.trace.ndjson*`
- `~/.t3/dev/logs/desktop.trace.ndjson`
- `~/.t3/dev/logs/server-child.log`

### 2. If you know the thread id, check the provider log first

Look for a matching file in:

- `~/.t3/dev/logs/provider/<thread-id>.log`

Questions to answer from the provider log:

- Did the session connect and become ready?
- Did the user turn start?
- Did assistant deltas begin streaming?
- Did the turn finish with `turn/completed`?
- Was `error` null or non-null?
- Did the thread return to `idle`?

Interpretation:

- If assistant deltas streamed and `turn/completed` has `error: null`, the provider did answer successfully
- If the UI is blank anyway, continue with projection and client-state checks

### 3. Query persisted projection state in SQLite

Check whether the thread still exists in persisted state:

```sql
SELECT thread_id, project_id, title, deleted_at, archived_at, latest_turn_id, updated_at
FROM projection_threads
WHERE thread_id = '<thread-id>';
```

Check whether detail rows still exist:

```sql
SELECT COUNT(*) FROM projection_thread_messages WHERE thread_id = '<thread-id>';
SELECT COUNT(*) FROM projection_thread_activities WHERE thread_id = '<thread-id>';
SELECT COUNT(*) FROM projection_thread_proposed_plans WHERE thread_id = '<thread-id>';
SELECT COUNT(*) FROM projection_pending_approvals WHERE thread_id = '<thread-id>';
```

If needed, inspect the actual message rows:

```sql
SELECT message_id, role, is_streaming, created_at, updated_at, length(text) AS text_len
FROM projection_thread_messages
WHERE thread_id = '<thread-id>'
ORDER BY created_at ASC, message_id ASC;
```

Interpretation:

- If the thread row exists and messages remain present, the backend did not lose the conversation
- That points toward a client-store, snapshot, reconnect, or render problem
- If the thread row is missing or marked deleted, continue on the server projection path before inspecting the web route

### 4. Check server traces for explicit removal or projection behavior

Search `server.trace.ndjson*` for:

- the thread id
- `thread.removed`
- `thread.deleted`
- `projection`
- `shellSnapshot`
- reconnect/bootstrap related activity

Goal:

- distinguish a real server-side removal from a client-side disappearance

### 5. Inspect the web-store and route path

For blank-thread incidents, check these files first:

- `apps/web/src/store.ts`
- `apps/web/src/threadDerivation.ts`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/environments/runtime/service.ts`
- `apps/web/src/environments/runtime/connection.ts`

Key things to verify:

- how shell snapshots are applied
- whether thread shell maps are rebuilt wholesale
- how thread existence is derived
- whether reconnect waits for a fresh snapshot
- what exact render guard returns `null`

## Known blank-thread failure pattern

This repo has a concrete blank-thread risk pattern:

- the thread detail route depends on thread existence in the client store
- `selectThreadExistsByRef(...)` effectively depends on `threadShellById[threadId]`
- `getThreadFromEnvironmentState(...)` returns `undefined` if the shell is missing
- the thread route renders `null` when the route thread no longer exists
- shell snapshots can rebuild thread shell state from snapshot payloads

Implication:

- if a fresh snapshot temporarily omits the active thread, the route can blank even when persisted server state and provider output are still intact

This means a user-visible blank conversation may be caused by client-side snapshot or reconnect behavior rather than lost data.

## Recommended debugging order

Use this order to keep investigations fast and falsifiable:

1. Provider thread log
2. Persisted thread row in SQLite
3. Persisted message/activity counts
4. Server trace for removal or projection anomalies
5. Web store selectors and route render guards

## Fast decision table

- Provider failed before streaming: focus on provider/session startup and runtime errors
- Provider completed cleanly but SQLite has no thread: focus on server projection/persistence
- Provider completed cleanly and SQLite still has thread and messages: focus on client state sync or rendering
- Thread is visible in sidebar but blank in route: strongly suspect thread shell loss, stale bootstrap state, or route-level `return null`

## Useful code anchors

- `apps/desktop/src/app/DesktopEnvironment.ts`
- `apps/desktop/src/app/DesktopApp.ts`
- `apps/desktop/src/app/DesktopObservability.ts`
- `apps/server/src/providerManager.ts`
- `apps/server/src/codexAppServerManager.ts`
- `apps/server/src/wsServer.ts`
- `apps/web/src/store.ts`
- `apps/web/src/threadDerivation.ts`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/environments/runtime/service.ts`
- `apps/web/src/environments/runtime/connection.ts`

## Investigation notes for future incidents

- Do not assume a blank thread means the assistant failed to answer
- Do not stop after finding the Electron `userData` path; check `~/.t3/dev` as the actual dev runtime state root
- Prefer proving each layer independently: provider log, SQLite state, then client route/store logic
- When a thread reappears after restart, treat that as evidence for transient client-state or reconnect handling, not data loss
