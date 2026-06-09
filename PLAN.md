# UI-Aware Subagent Orchestration Plan

## Assessment

The goal is feasible for Codex, but it is not a small rendering-only change. The current customized implementation already detects Codex `collabAgentToolCall` items, remembers their receiver thread ids, suppresses child lifecycle noise, and folds child `item/agentMessage/delta` text back into one parent `Subagent` activity. To reach the desired UX, that behavior needs to be inverted: each child provider thread should become its own canonical T3 thread, while the parent keeps only a durable subagent reference block.

The current architecture has three major gaps:

1. Thread metadata has no parent-child fields. `thread.created`, `OrchestrationThread`, `OrchestrationThreadShell`, `ProjectionThread`, web `Thread`, and `SidebarThreadSummary` do not currently carry subagent lineage, provider child-thread id, parent thread id, parent item id, depth, or active-only sidebar visibility metadata.
2. Codex child events are currently normalized onto the parent T3 thread. `CodexSessionRuntime` resolves child-parent info, but emits canonical events using `options.threadId`; `CodexAdapter` only attaches `parentCollab` to child assistant deltas. Command output, file changes, MCP progress, approvals, turn lifecycle, and errors are not first-class child-thread activity in the UI.
3. Sidebar and routing assume the shell snapshot is the set of visible/known active threads. Finished child threads must be hidden from the sidebar while remaining addressable from parent blocks, so the client needs a way to route to and subscribe to hidden-but-valid subagent thread detail.

Provider support should be Codex-only for this first implementation because Codex app-server events include provider `threadId`s and `collabAgentToolCall.receiverThreadIds`. Claude currently classifies `Task`/agent tools as `collab_agent_tool_call`, and OpenCode exposes child-session concepts, but the reviewed T3 adapter paths do not expose the same durable child-thread lineage. Unsupported providers should keep the current behavior until they can produce a durable parent/child correlation.

The existing branch customization that folds Codex child output into a parent `Subagent` box should be treated as temporary compatibility code. Once Codex child threads are first-class, the Codex-specific parent-output buffering, child assistant delta coalescing, and parent `rawOutput.content` draining should be removed or limited to unsupported-provider fallback paths.

## Target Model

- A parent thread may have zero or more direct subagent child threads.
- Each subagent child is a real T3 thread detail view with its own messages, activities, approvals, tool calls, file-change rows, MCP rows, status, and timing.
- A parent thread detail view shows only its own output plus one special `Subagent - <child title>` block per direct child.
- A parent thread detail view does not show child command rows, child file diffs, child MCP rows, or child assistant output.
- A child thread view behaves like the current thread view, but can show its own direct subagent blocks.
- Active child threads appear in the sidebar nested under their direct parent. Completed/errored/stopped child threads disappear from the sidebar but remain reachable through the parent subagent block.
- Nested children appear recursively in the sidebar only while active, under their direct parent.
- Completed child detail retention is tied to the top-most parent: deleting or archiving the root parent applies to the full child tree.
- Stopping a parent manually does not automatically stop active children. A child can be stopped explicitly from its own thread view.
- Users cannot manually prompt, continue, queue input for, or steer a subagent. The only user control exposed from a child view is stop/interrupt; all other control belongs to the agent that spawned the child.
- Child failures are isolated to the child thread and the parent subagent block status; they should not fail the parent thread.
- Parent diff/checkpoint views should be parent-visible in aggregate, including descendant child changes that affected the same workspace.

## Proposed Data Model

Add a first-class subagent relationship object to the contracts and projection:

```ts
type ThreadParentRelation =
  | { kind: "root"; rootThreadId: ThreadId }
  | {
      kind: "subagent";
      rootThreadId: ThreadId;
      parentThreadId: ThreadId;
      parentTurnId: TurnId | null;
      parentItemId: ProviderItemId;
      parentActivitySequence: number;
      providerThreadId: string;
      titleSeed: string | null;
      depth: number;
      startedAt: IsoDateTime;
      completedAt: IsoDateTime | null;
      status: "running" | "completed" | "errored" | "interrupted" | "stopped";
    };
```

The exact shape can be adjusted during implementation, but the important fields are `rootThreadId`, `parentThreadId`, `parentItemId`, `parentActivitySequence`, `providerThreadId`, `titleSeed`, `depth`, status, and timing. This metadata should live on both full thread detail and shell/sidebar summaries.

Persist this in `projection_threads` with a migration. Keep root threads backwards-compatible by defaulting to `kind: "root"` with `rootThreadId` equal to the thread's own id and nullable subagent columns. Root-thread archive/delete should cascade by `rootThreadId`; child-specific archive/delete actions should be hidden or rejected.

## Server Plan

1. Extend contracts and projection schemas.
   - Add subagent relationship fields to `ThreadCreateCommand`, `ThreadCreatedPayload`, `ThreadMetaUpdatedPayload` if needed, `OrchestrationThread`, `OrchestrationThreadShell`, and shell/detail snapshot schemas.
   - Add matching fields to web `Thread`, `ThreadShell`, and `SidebarThreadSummary`.
   - Add persistence migration columns and repository mapping in `ProjectionThreads`.
   - Update shell snapshot queries to include active root threads plus active subagent threads; completed subagent threads should be excluded from the shell sidebar query but still available through detail lookup.
   - Root sorting should remain unchanged. Nested active child sorting should use `parentActivitySequence` first and `startedAt` second, so child rows do not destabilize root ordering.

2. Create a subagent-thread registry in the Codex runtime path.
   - Track provider thread id to canonical T3 thread id.
   - When a `collabAgentToolCall` starts or completes with `receiverThreadIds`, create or resolve one child T3 thread per receiver thread.
   - Use a deterministic child `ThreadId` derived from parent T3 thread id plus parent collab item id, so duplicate lifecycle events do not create duplicate threads.
   - For nested subagents, resolve the direct parent from the provider thread that emitted the collab item, not from the root parent.

3. Emit canonical runtime events against the correct T3 thread.
   - Route child provider-thread events to the child T3 thread id instead of `options.threadId`.
   - Stop suppressing child lifecycle events that should populate the child thread view.
   - Continue suppressing or transforming only the events that would duplicate parent presentation.
   - Preserve command output, file-change output, patch updates, MCP tool progress, approval requests/responses, runtime warnings/errors, token usage, and turn lifecycle on the child thread.
   - Keep unsupported-provider behavior unchanged, including the current parent-visible subagent activity behavior where no durable child thread mapping exists.

4. Emit a parent subagent-reference activity.
   - Add a dedicated activity kind, for example `subagent.thread.started` / `subagent.thread.updated` / `subagent.thread.completed`, or a single upsert-like `tool.updated` payload with a new item type if that fits existing reducers better.
   - Payload should include child thread id, direct parent thread id, parent collab item id, title, status, startedAt, completedAt, and any error summary.
   - This parent activity is the only child-related thing shown in the parent conversation timeline.

5. Title generation.
   - Seed the child title from the collab prompt/detail immediately, using the same truncation behavior as normal draft thread creation. The current Codex prompt extraction used for the parent `PROMPT` block is the likely source.
   - Feed that extracted prompt/detail into the same title-generation path as a prompt-equivalent input, even when the child thread does not contain a normal user message.
   - If no generated title arrives, keep the prompt-derived title.

6. Detail lookup for hidden child threads.
   - Ensure `getThreadDetailById` can read completed subagent threads even when they are omitted from the active shell snapshot.
   - Prefer a detail prefetch/subscription route guard over returning hidden completed children in the normal shell snapshot. This keeps the sidebar query authoritative for visible rows while allowing parent blocks to navigate to hidden child detail.
   - `getThreadShellById` can return hidden child metadata for a specific id if needed by route validation, but list/snapshot queries should only include active children.

7. Error, completion, and missing-completion semantics.
   - Map child `turn/completed` failed states, child runtime errors, and unexpected exits to the child relation status and parent block status only.
   - Do not propagate child failures to the parent session status.
   - If a child provider omits a completion event, follow the same reconciliation path used for a normal active thread: keep it running while the session reports active, mark interrupted/stopped only when session stop, interruption, or provider status indicates that outcome, and avoid inventing a timeout unless the existing parent-thread lifecycle already has one.

8. Stop, interrupt, and steering.
   - Parent `stopSession` should target only the parent canonical thread and should not cascade to active child sessions.
   - Child `stopSession` and `interruptTurn` should work from the child thread route and target the child provider thread mapping.
   - Do not expose user prompting, continuation, queued input, or steering for subagent threads. Even if a provider supports active-turn steering, that control should remain unavailable to users for child threads.
   - Codex app-server supports `turn/steer` for active regular turns with an `expectedTurnId` precondition, but T3's current `ProviderAdapter` shape does not expose steering. If steering is added later, it should apply only where product policy allows it, not to user control of child threads.
   - OpenCode currently exposes async prompt and abort endpoints in the reviewed docs/adapter path, but no same-turn steering equivalent. Treat active-turn steering as unsupported for OpenCode until the provider adapter exposes a precise capability.

9. Diff/checkpoint aggregation.
   - Keep child file-change rows and checkpoints visible inside the child thread view.
   - Update parent diff/checkpoint queries to aggregate descendant child changes by `rootThreadId`, with ordering that preserves the parent/child activity sequence.
   - Avoid double-counting the same workspace diff when both parent and child report overlapping snapshots; prefer the latest workspace state for aggregate diff views.

10. Archive/delete lifecycle: archive/delete actions should be available only for root threads in the UI. Server commands should cascade archive/delete to all descendants by `rootThreadId`, including hidden completed children and any active children. Parent subagent blocks remain part of retained parent history until the root parent is archived/deleted.

11. Retire obsolete branch customizations: remove Codex-specific subagent output buffering and `rawOutput.content` draining once child event routing is implemented. Rewrite or delete web/runtime coalescing paths that merge child deltas into parent activities for Codex. Preserve normal root-thread command/file/MCP rendering and any unsupported-provider fallback behavior.

## Web Plan

1. Update store normalization.
   - Add parent relation fields to shell/detail mapping, equality checks, reducers, and client-runtime managers.
   - Keep detail content keyed by child thread id as normal; do not merge child messages/activities into the parent.

2. Update sidebar derivation.
   - Build a tree from visible shell threads: roots at level 0, active subagents nested under their direct parent.
   - Render active subagents indented inside the parent row using the existing `SidebarMenuSub` primitives.
   - Preserve sorting for root threads. For active child threads, prefer parent activity order or child start time over global updated time, so nested entries do not jump unexpectedly.
   - Exclude completed subagent threads from sidebar lists while keeping their state in store if loaded through detail subscriptions.
   - Because the shell snapshot carries active child relation metadata, web, desktop, VS Code, and mobile clients should derive the same active nesting from the same subscription data.

3. Update routing.
   - Allow `/environment/threadId` to open hidden completed subagent threads from parent blocks.
   - If a hidden child detail is not in shell state yet, subscribe/fetch detail before redirecting away.
   - Maintain normal behavior for genuinely missing/deleted threads.

4. Replace current subagent output rows in the parent timeline.
   - Add a `Subagent - <title>` block component with running/completed/errored/interrupted status, elapsed or total duration, and click navigation to the child thread.
   - The block should not expand to show child logs; navigation is the drill-down path.
   - Parent timeline derivation must filter out child-owned events entirely.
   - Unsupported providers continue to use the current inline subagent activity behavior until they expose first-class child lineage.

5. Child thread view.
   - Reuse the existing `ChatView` and `MessagesTimeline` for child threads.
   - Optionally add a compact breadcrumb/back affordance in `ChatHeader` for subagent threads: parent title > child title.
   - A child view should show only its own direct subagent blocks, not grandchildren inline.
   - Hide archive/delete actions for child and nested-child views. Root parent archive/delete controls the retained subtree.
   - Expose stop/interrupt controls for the current child thread, targeting the child relation rather than the root parent.
   - Hide or disable the composer for child and nested-child views. Users should not be able to prompt, continue, queue input for, or steer subagents.

6. Timing and status.
   - Derive running duration from `startedAt` to now while active.
   - Derive completed duration from `startedAt` to `completedAt`.
   - Status should prefer explicit subagent relation status; fall back to latest turn/session state only if relation status is missing.

## Testing Plan

- Codex adapter/runtime tests:
  - parent collab creates one deterministic child thread relation;
  - child agent messages route to child thread, not parent;
  - child command/file/MCP/approval events route to child thread;
  - parent receives only subagent reference activities;
  - nested provider threads resolve to direct parent, not root parent;
  - duplicate lifecycle notifications do not create duplicate child threads;
  - child failure updates child status and parent block status without failing the parent thread;
  - stopping a parent does not stop active child sessions;
  - stopping a child targets only the child provider thread.
- Orchestration/projection tests:
  - subagent metadata persists and rehydrates in shell/detail snapshots;
  - active child threads are included in shell snapshots;
  - completed child threads are hidden from shell snapshots but detail lookup still works;
  - parent subagent block remains in parent activity history after child completion;
  - root archive/delete cascades to hidden and active descendants;
  - child archive/delete actions are rejected or unavailable.
- Web store/client-runtime tests:
  - shell/detail reducers preserve parent relation;
  - hidden child detail can be retained without sidebar membership;
  - active nested children render in the correct parent-child order;
  - unsupported providers continue to render current fallback subagent activities.
- UI tests:
  - parent timeline shows a clickable `Subagent - <title>` block only;
  - child timeline shows child output/actions and its own child blocks;
  - sidebar nests active child and grandchild threads and removes them when finished;
  - route navigation from parent block opens the hidden completed child thread;
  - child view can be stopped independently from its parent;
  - child view does not expose prompt, continue, queued-input, or steering controls;
  - root-only archive/delete controls are visible only on root threads.
- Regression tests:
  - current command/file-change expandable rows still work in normal root threads;
  - existing subagent coalescing tests are rewritten or retired because output is no longer folded into the parent row.

Before considering the implementation complete, run:

```sh
pnpm exec vp check
pnpm exec vp run typecheck
pnpm run test
```

If changing native mobile code or shared client-runtime behavior consumed by mobile, also run:

```sh
pnpm exec vp run lint:mobile
```

## Final Decisions Captured

1. Persistence is tied to the top-most parent. Completed child detail remains reachable from parent blocks until the root parent is archived/deleted.
2. Provider scope is Codex-only for first implementation. Claude/Cursor/OpenCode keep current behavior until durable lineage exists.
3. Child titles are seeded from the collab prompt/detail, reusing the existing prompt extraction that currently powers the `PROMPT` block.
4. Child failures are isolated. They update child status and the parent block, but do not fail the parent thread.
5. Parent stop does not cascade to children. Child stop/interrupt is available from the child thread view.
6. User prompting/steering of subagents is not allowed. Codex supports `turn/steer`, but that must not be exposed as user control for child threads; OpenCode has no documented same-turn steering equivalent in the reviewed API.
7. Child diffs/checkpoints remain visible inside child views and are parent-visible in aggregate at the root.
8. Archive/delete is root-only in the UI and cascades through the retained child tree.
9. Route validity should use detail prefetch/subscription for hidden child threads rather than making completed children visible in normal sidebar snapshots.
10. Sidebar sorting keeps root ordering stable and orders active children by parent activity sequence, then child `startedAt`.
11. Multi-client behavior should be driven by shared shell/detail contracts so every client derives the same active child nesting.

## Implementation Risks To Recheck

1. The deterministic child `ThreadId` scheme must survive restarts and duplicate Codex lifecycle events without colliding across nested children.
2. Parent aggregate diff queries need careful de-duplication so overlapping parent/child workspace snapshots do not show duplicate patches.
3. If Codex emits a child provider thread before the parent collab item has been persisted, the registry needs a pending-resolution queue rather than dropping early child events.
4. Unsupported-provider fallback should be preserved until each provider can prove durable child-thread lineage.
