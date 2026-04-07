# CodeRabbit Integration for T3 Code

Integrate CodeRabbit reviews directly into T3 Code using `coderabbit review --agent --no-color`.

V1 should optimize for reliability, reconnect safety, and reuse of existing T3 Code primitives. The goal is not to clone the full CodeRabbit VS Code extension on day one. The goal is to make local CodeRabbit review feel native inside T3 Code without introducing a second orchestration system, fragile diff assumptions, or UI state that disappears on every reconnect.

## V1 Principles

- The server owns review lifecycle and review state.
- Browser disconnects, panel closes, and tab switches must not kill an active review.
- Reuse existing chat, diff, git, and orchestration flows wherever possible.
- Prefer accurate file-level findings over fragile line anchoring.
- Normalize CLI output from captured fixtures rather than baking raw CLI payloads into shared contracts.
- Keep the first version small enough that it remains predictable under failure.

## Architecture

Three layers: server review service, shared contracts, and web UI.

```text
┌──────────────────────────────────────────────────────────────┐
│ Web (apps/web)                                              │
│ ┌────────────────────┐   ┌───────────────────────────────┐  │
│ │ Chat Route Right   │   │ DiffPanel (existing)          │  │
│ │ Rail: Diff/Review  │──▶│ optional CodeRabbit overlays  │  │
│ │ tabs, progress,    │   │ when a reviewed file is       │  │
│ │ findings, fix CTA  │   │ already present in the diff   │  │
│ └──────────┬─────────┘   └───────────────────────────────┘  │
├────────────┼────────────────────────────────────────────────┤
│ Contracts (packages/contracts)                              │
│ Normalized review snapshot/events + RPC schemas             │
├────────────┼────────────────────────────────────────────────┤
│ Server (apps/server)                                        │
│ ┌──────────┴─────────┐                                      │
│ │ CodeRabbitService  │──▶ spawns `coderabbit review --agent`│
│ │ review registry    │◀── parses NDJSON / structured JSON   │
│ │ replay + fanout    │                                      │
│ └────────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
```

## Design Notes

### Reuse the existing right rail

V1 should reuse the existing right-side diff rail in [apps/web/src/routes/\_chat.$threadId.tsx](/Users/james/dev/t3code/apps/web/src/routes/_chat.$threadId.tsx) instead of adding a second simultaneous right column.

- Desktop: one right rail with a tab or segmented control for `Diff` and `Review`
- Mobile/narrow layouts: the same shared sheet behavior the diff panel already uses
- V1 intentionally does not support DiffPanel and CodeRabbit as two side-by-side rails at once

This keeps layout pressure manageable and avoids re-solving the composer width constraints that the current diff sidebar already handles.

### The review panel is the source of truth

The CodeRabbit review panel is the primary place to browse findings.

The DiffPanel may optionally render CodeRabbit annotations, but only when the reviewed file is already present in the currently rendered thread diff. CodeRabbit findings must not depend on the DiffPanel being able to render an arbitrary Git comparison that it does not currently support.

## Server: `CodeRabbitService`

**Primary file:** [apps/server/src/coderabbit/CodeRabbitService.ts](/Users/james/dev/t3code/apps/server/src/coderabbit/CodeRabbitService.ts)

The server owns the review process.

`CodeRabbitService` should be an Effect service (`Context.Tag`) responsible for spawning the CLI, normalizing its output, tracking in-memory review state, and serving both snapshot queries and event streams.

### Responsibilities

- Spawn `coderabbit review --agent --no-color` with supported flags:
  - `--type all | committed | uncommitted`
  - `--base <branch>` when provided
  - `--cwd <path>`
- Parse the CLI output line-by-line and normalize it into typed T3 Code review events
- Maintain an in-memory review registry keyed by `reviewId`
- Allow at most one active review per project `cwd`
- If a new review starts for the same `cwd`, cancel the previous active review and mark it cancelled
- Keep the latest review snapshot in memory until it is replaced by a newer review for the same `cwd` or the server restarts
- Fan out live events to multiple subscribers
- Replay the current snapshot to newly attached clients
- Generate stable server-side `findingId` values
- Detect CLI availability and auth status using:
  - `coderabbit --version`
  - `coderabbit auth status --agent`
- Use Effect `Scope` / finalizers to guarantee child-process cleanup
- Log unknown or unmapped raw CLI event shapes so parser drift is visible during upgrades

### What it must not do

- No durable persistence across server restarts in v1
- No direct edits to workspace files from CodeRabbit suggestions
- No changes to the orchestration engine beyond dispatching existing orchestration commands

### Review lifecycle

1. Client calls `coderabbitStartReview`
2. Server creates `reviewId`, allocates an in-memory review entry, and starts the CLI subprocess
3. Server updates the review snapshot as normalized events arrive
4. Clients call `coderabbitGetReview` for the latest snapshot and `subscribeCodeRabbitReviewEvents` for live updates
5. If the client disconnects or closes the panel, the review continues running
6. Only explicit cancellation, server shutdown, or a replacement review for the same `cwd` ends the subprocess
7. Terminal review state remains queryable after completion so the browser can reconnect cleanly

This is intentionally different from the original draft. Closing the panel or losing the WebSocket should not kill the review.

## Contracts: review schemas and RPC

**Primary file:** [packages/contracts/src/coderabbit.ts](/Users/james/dev/t3code/packages/contracts/src/coderabbit.ts)

This package stays schema-only.

### Normalized review model

Do not expose raw CodeRabbit CLI payloads directly to the rest of the app.

Define a normalized model with stable T3 Code semantics:

- `CodeRabbitReviewScope`
  - `"all" | "committed" | "uncommitted"`
- `CodeRabbitReviewPhase`
  - `"starting" | "setup" | "analyzing" | "complete" | "error" | "cancelled"`
- `CodeRabbitFindingSeverity`
  - `"critical" | "high" | "medium" | "low" | "info"`
- `CodeRabbitFindingLocation`
  - file-level by default
  - optional line-level only when the server has a reliable structured line number
- `CodeRabbitFinding`
  - `id`
  - `reviewId`
  - `filePath`
  - `severity`
  - `summary`
  - `codegenInstructions`
  - `suggestions: string[]`
  - `location`
- `CodeRabbitReviewSnapshot`
  - `reviewId`
  - `cwd`
  - `scope`
  - `baseBranch`
  - `currentBranch`
  - `phase`
  - `statusMessage`
  - `startedAt`
  - `completedAt`
  - `findings`
  - `changedFiles` when available

### Event stream

The stream should carry normalized delta events, not raw CLI lines.

Suggested union:

- `ReviewSnapshot`
- `ReviewStatusUpdated`
- `ReviewFindingAdded`
- `ReviewCompleted`
- `ReviewErrored`
- `ReviewCancelled`

The snapshot is the durable server-side read model. Events are incremental updates.

### Important schema rule

The schema should be derived from captured real CLI fixtures for the pinned CodeRabbit CLI version, not from hand-written assumptions about undocumented fields.

Add parser fixtures and tests on the server side before relying on any raw field shape.

### RPC methods

Add methods to [packages/contracts/src/rpc.ts](/Users/james/dev/t3code/packages/contracts/src/rpc.ts).

**Unary RPCs**

| Method                   | Input                                                                                    | Output                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `coderabbitStartReview`  | `{ cwd: string, scope: "all" \| "committed" \| "uncommitted", baseBranch?: string }`     | `{ reviewId: string }`                                                           |
| `coderabbitCancelReview` | `{ reviewId: string }`                                                                   | `void`                                                                           |
| `coderabbitGetStatus`    | `{ cwd: string }`                                                                        | `{ available: boolean, authenticated: boolean, activeReviewId: string \| null }` |
| `coderabbitGetReview`    | `{ reviewId: string }`                                                                   | `CodeRabbitReviewSnapshot`                                                       |
| `coderabbitFixWithAI`    | `{ reviewId: string, findingIds: string[], projectId: string, sourceThreadId?: string }` | `{ threadId: string }`                                                           |

**Stream RPC**

| Method                            | Input                  | Output                          |
| --------------------------------- | ---------------------- | ------------------------------- |
| `subscribeCodeRabbitReviewEvents` | `{ reviewId: string }` | `Stream<CodeRabbitReviewEvent>` |

### Web RPC client implication

The current web RPC helper only exposes no-argument subscriptions. This integration requires stream subscriptions with input payloads, so [apps/web/src/wsRpcClient.ts](/Users/james/dev/t3code/apps/web/src/wsRpcClient.ts) will need a small abstraction upgrade.

## Web: review rail

**Primary files**

- [apps/web/src/routes/\_chat.$threadId.tsx](/Users/james/dev/t3code/apps/web/src/routes/_chat.$threadId.tsx)
- [apps/web/src/components/CodeRabbitPanel.tsx](/Users/james/dev/t3code/apps/web/src/components/CodeRabbitPanel.tsx)
- [apps/web/src/wsRpcClient.ts](/Users/james/dev/t3code/apps/web/src/wsRpcClient.ts)

### Trigger

Add a CodeRabbit button near the existing diff toggle.

When opened, the shared right rail switches to the `Review` tab. The existing `Diff` tab remains available in the same rail.

### Layout

**Section 1: New review**

- Base branch picker
  - Reuse the existing branch search infrastructure that already backs `gitListBranches`
- Scope split button
  - Review all changes
  - Review committed changes
  - Review uncommitted changes
- Review action button
  - Starts a new review
- Stop review button
  - Replaces the action button when a review is active

**Section 2: Active review**

- Current branch / base branch summary
- Progress checklist or status list
- Latest status text from the server snapshot
- Findings grouped by file

**Section 3: Fix actions**

- `Fix selected finding`
- `Fix flagged files`
- Progress text should say `N of M fix sessions completed`

Do not label this as `resolved` in v1. A completed AI thread is not the same thing as a verified fix.

### Pre-review file list

Do not assume the existing `gitStatus` RPC can power the full scope selector.

- `gitStatus` only covers working-tree changes
- `committed` and `all` need a separate server-side diff summary if we want an accurate preview before the review starts

Because of that, the changed-files preview is optional in v1:

- Show it when the server can provide it reliably
- Do not block the feature on a preflight file list for every scope

## Web state management

Avoid duplicating the full server review snapshot into a separate long-lived client store.

Recommended split:

- React Query or equivalent request lifecycle for:
  - `coderabbitGetStatus`
  - `coderabbitGetReview`
  - reconnect-safe review refresh
- Lightweight Zustand store for local UI state only:
  - selected base branch
  - selected scope
  - selected finding
  - review rail tab
  - fix session progress mapping

**Suggested file:** [apps/web/src/coderabbitStore.ts](/Users/james/dev/t3code/apps/web/src/coderabbitStore.ts)

The server snapshot remains the source of truth for findings and review progress.

## DiffPanel annotations

**Primary file:** [apps/web/src/components/DiffPanel.tsx](/Users/james/dev/t3code/apps/web/src/components/DiffPanel.tsx)

Annotations in the DiffPanel are optional enhancement, not the main review surface.

### V1 behavior

- If the current DiffPanel file path matches a file with CodeRabbit findings, show file-level annotation blocks
- If the reviewed file is not present in the current rendered diff, the review panel still works normally
- Clicking a finding:
  - opens the Diff tab and focuses the file if that file exists in the current diff
  - otherwise opens the file in the editor and keeps the review panel selection active

### Annotation content

Each annotation may show:

- Severity badge
- Short summary
- Expandable suggestion text when `suggestions[]` is non-empty
- `Fix with AI`

### No direct `Apply fix` in v1

Do not wire CodeRabbit suggestions straight to `projectsWriteFile`.

[projectsWriteFile](/Users/james/dev/t3code/packages/contracts/src/project.ts) writes full file contents, and the plan cannot safely assume CodeRabbit suggestions are always full-file replacements. Direct file mutation risks clobbering user edits.

If we later add direct apply, it should use a patch-aware flow with explicit preview and conflict handling.

### Line anchoring

V1 should default to file-level findings.

Do not parse line numbers out of natural-language `codegenInstructions` with regex as a primary strategy. That is too fragile.

Only attach a line when the server has a reliable structured line number from CodeRabbit output or a strongly validated parser path. Until then, file-level annotations are the correct default.

## "Fix with AI" flow

### Single finding or grouped findings

The client sends stable finding IDs back to the server, not raw `codegenInstructions` copied from the browser.

1. User selects one or more findings
2. Client calls `coderabbitFixWithAI({ reviewId, findingIds, projectId, sourceThreadId? })`
3. Server loads the review snapshot and constructs the prompt from the canonical finding data
4. Server creates a normal orchestration thread using the existing orchestration command path
5. Server starts the first turn with a prompt that includes:
   - finding summaries
   - file paths
   - `codegenInstructions`
   - any suggestion text
6. Server returns `{ threadId }`

### Thread bootstrap

Implementation should reuse the same orchestration bootstrapping pattern already used by chat flows in [apps/server/src/ws.ts](/Users/james/dev/t3code/apps/server/src/ws.ts) and [apps/web/src/components/ChatView.tsx](/Users/james/dev/t3code/apps/web/src/components/ChatView.tsx).

Preferred inheritance order:

1. Source thread settings, when `sourceThreadId` is provided
2. Existing project defaults

Carry over:

- model selection
- runtime mode
- interaction mode
- active branch / worktree path when applicable

### "Fix flagged files"

Group findings by `filePath` and create one AI fix session per file.

That keeps related issues together while avoiding a single oversized prompt for an entire review.

### Progress tracking

Track file-group or request-level fix sessions on the client.

The UI should count how many fix sessions reached a terminal thread state. It should not claim the issue is fixed unless the review is rerun and passes.

## Error handling

### CLI not installed

Show `CodeRabbit CLI not installed` with install guidance. Review controls stay disabled.

### Not authenticated

Show `Not signed in` with guidance to run `coderabbit auth login --agent` or `coderabbit auth login` in the terminal, depending on the final UX decision for auth.

### Unknown raw CLI event shape

Do not crash the review parser on one unknown line.

- Log the raw event shape on the server
- Surface a generic status update if possible
- Keep the review running unless the CLI itself exits or returns a terminal error

### Review fails mid-stream

Surface the error in the review snapshot and mark the review terminal with phase `error`.

### No files to review

Show a clear empty state and allow the user to change scope or base branch.

### Rate limiting

Surface CodeRabbit rate-limit responses directly when available.

### Subprocess cleanup

Kill the subprocess on:

- explicit cancel
- replacement by a newer review for the same `cwd`
- server shutdown

Do not kill it just because the panel closed or the WebSocket disconnected.

### Server restart

Because review state is in-memory only in v1, server restart ends active reviews. The UI should handle this as a lost review state and offer a clean restart path.

## Testing and fixtures

This feature should not ship without parser fixtures.

Add:

- Captured `coderabbit review --agent` fixture output for the pinned CLI version
- Parser unit tests for raw event normalization
- WebSocket subscription tests that verify:
  - reconnect
  - replay from `coderabbitGetReview`
  - live event fanout
  - cancellation semantics
- UI tests for:
  - switching between `Diff` and `Review`
  - starting a review
  - reconnecting to an in-flight review
  - launching `Fix with AI`

## File inventory

| File                                       | Package            | Purpose                                                                            |
| ------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------- |
| `src/coderabbit/CodeRabbitService.ts`      | apps/server        | CLI subprocess management, parser, review registry, replay/fanout                  |
| `src/coderabbit/CodeRabbitService.test.ts` | apps/server        | Parser and lifecycle tests                                                         |
| `src/coderabbit/fixtures/*.jsonl`          | apps/server        | Real captured CLI fixtures for the pinned CodeRabbit version                       |
| `src/ws.ts`                                | apps/server        | Wire RPC handlers into the existing WS server                                      |
| `src/coderabbit.ts`                        | packages/contracts | Review snapshot, event, and RPC schemas                                            |
| `src/rpc.ts`                               | packages/contracts | Register CodeRabbit RPC methods with `WsRpcGroup`                                  |
| `src/wsRpcClient.ts`                       | apps/web           | Add input-bearing review stream subscription support                               |
| `src/routes/_chat.$threadId.tsx`           | apps/web           | Reuse existing right rail / sheet for the Review tab                               |
| `src/components/CodeRabbitPanel.tsx`       | apps/web           | Review panel UI                                                                    |
| `src/components/DiffPanel.tsx`             | apps/web           | Optional file-level review annotations when a reviewed file is already in the diff |
| `src/coderabbitStore.ts`                   | apps/web           | Local UI-only state for review rail, selection, and fix-session progress           |

## Summary

The original concept is solid, but the implementation should be narrowed for v1:

- server-owned review state
- reconnect-safe snapshots and streams
- one shared right rail instead of dual rails
- file-level findings by default
- no direct apply-to-file shortcut
- fix progress measured as completed AI sessions, not verified resolutions

That version is much more aligned with T3 Code's stated priorities around performance, reliability, and predictable behavior under failure.
