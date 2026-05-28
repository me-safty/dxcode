# Custom Branch Changes

This branch carries local conversation-rendering changes that are not assumed to exist upstream. Keep this file current when changing local behavior so future merges can preserve the intended UX, and so these patches can be removed when upstream covers the same behavior.

## Conversation Tool Activity Rendering

The custom behavior is focused on making subagent and tool activity easier to read in long-running Codex threads without changing agent execution semantics.

### Subagent Activity Boxes

Subagent activity is rendered as a collapsible tool-style row instead of letting child-agent text stream directly into the main conversation timeline.

Expected behavior:

- A subagent should appear as a single logical `Subagent` activity for the parent collab tool call.
- While the subagent is running, the UI may show the parent prompt/title as the activity preview.
- When expanded, the box shows `Prompt` and `Output` sections.
- If prompt and output are identical, or one starts with the other, only the output is shown.
- Empty placeholder subagent lifecycle rows are omitted, so a single subagent should not render as repeated blank `Subagent` rows around prompt/output rows.
- Child subagent output should not be rendered as a normal assistant message in the main conversation.

Primary files:

- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/environments/runtime/service.ts`
- `apps/web/src/store.ts`

### Codex Subagent Event Handling

Codex child-thread events are correlated back to the parent collab tool call.

Server-side custom behavior:

- Remember receiver thread ids for Codex `collabAgentToolCall` items.
- Attach `parentCollab` metadata to child `item/agentMessage/delta` events.
- Suppress child thread and child agent-message lifecycle notifications that would otherwise leak into the parent conversation.
- Buffer child subagent output deltas in memory in the adapter, keyed by parent thread and collab item id.
- Emit an immediate parent subagent activity when the parent collab item starts.
- Drain buffered child output into the parent collab `item.completed` event as `rawOutput.content`.
- Clear any buffered subagent output when a session is stopped.

Important merge rule:

If upstream changes Codex app-server event shapes, preserve the invariant that the web app receives enough metadata to identify the parent subagent tool call: `itemType: "collab_agent_tool_call"` plus either `data.toolCallId`, `data.parentCollab.itemId`, or `data.item.id`.

### Live Stream Coalescing

The live event path includes local coalescing to avoid repeatedly appending and removing subagent token chunks under load.

Expected behavior:

- Consecutive subagent output chunks for the same tool call are merged in the runtime service.
- Store updates merge live subagent output by parent tool call before activity retention limits are applied.
- Same-timestamp streamed chunks preserve arrival order instead of being sorted by random event ids.
- The reload/snapshot path remains separate and should continue to display the full persisted activity history.

Primary files:

- `apps/web/src/environments/runtime/service.ts`
- `apps/web/src/store.ts`
- `apps/web/src/session-logic.ts`

## Tests Covering The Custom Behavior

Relevant tests live in:

- `apps/server/src/provider/Layers/CodexAdapter.test.ts`
- `apps/web/src/components/chat/MessagesTimeline.test.tsx`
- `apps/web/src/environments/runtime/service.coalescing.test.ts`
- `apps/web/src/session-logic.test.ts`
- `apps/web/src/store.test.ts`

Useful focused commands:

```sh
bun run --filter t3 test src/provider/Layers/CodexAdapter.test.ts
bun run --filter @t3tools/web test src/session-logic.test.ts
bun run --filter @t3tools/web test src/environments/runtime/service.coalescing.test.ts src/store.test.ts src/components/chat/MessagesTimeline.test.tsx
```

Before considering the branch healthy, also run:

```sh
bun fmt
bun lint
bun typecheck
```

## Merge Guidance

When merging from upstream, keep these local behaviors unless upstream has an equivalent implementation:

1. Subagent output is isolated inside a subagent activity box, not streamed as top-level assistant text.
2. Each parent subagent/collab tool call renders as one logical activity, not prompt/output/blank rows.
3. Subagent output is buffered or coalesced enough that token-by-token UI churn does not make long threads sluggish.
4. Prompt and output display stays deduplicated in expanded subagent details.
5. Empty subagent placeholder activities stay hidden.

## Retirement Criteria

These local patches can be removed when upstream provides all of the following:

- A canonical parent-child relationship for subagent/collab tool events.
- A UI model that groups subagent prompt and output into one expandable activity.
- Live-stream coalescing or buffering that avoids token-by-token re-render churn for subagent output.
- Tests or contracts that guarantee subagent output does not leak into the main conversation as normal assistant text.

When retiring the local changes, remove the corresponding tests or update them to assert the upstream behavior directly.
