# Sub-Agent Worktrees

## Summary

T3 Code now supports specialist sub-agents that run in isolated git worktrees and return only a distilled report to the parent thread.

The current implementation is Codex-first and uses external Codex skills from:

- `CODEX_HOME/skills`
- fallback: `~/.codex/skills`

## User Flow

1. A user runs `/skill <skill-id> <task>`.
2. The server creates a `SubagentRun` on the parent thread with status `preparing`.
3. `SubagentCoordinator` creates a new git worktree and branch for the run.
4. The server creates a hidden orchestration thread with:
   - `threadKind = "subagent"`
   - `parentThreadId = <main thread id>`
5. The hidden thread starts a normal Codex turn with skill prompt injected through `developerInstructions`.
6. When the hidden turn quiesces, the server synthesizes a structured report from the hidden assistant output and checkpoint data.
7. The parent thread shows a specialist report card instead of the hidden conversation history.

## Important Behavior

- Hidden sub-agent threads do not appear in the normal thread list.
- `Open worktree thread` creates a normal visible thread on the retained sub-agent worktree.
- `Use report` inserts the distilled report into the composer only. It does not auto-send.
- `Discard` cleans up the sub-agent worktree and branch.
- If a visible thread was opened on that worktree, cleanup now detaches it back to a normal local thread so it does not keep a dead `cwd`.
- Generic thread deletion also treats already-missing worktrees as a safe no-op.

## Current Skill Source

Skill discovery is server-side and reads `SKILL.md` files from the external Codex skill home.

V1 assumptions:

- no repo-local `.agents/skills`
- no VS Code extension internals
- no `tools.json`
- no `report-schema.md`

The only required skill artifact is `SKILL.md`.

## Key Files

### Contracts

- `packages/contracts/src/subagent.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/server.ts`

### Server

- `apps/server/src/subagents/Layers/SkillCatalog.ts`
- `apps/server/src/subagents/Layers/SubagentCoordinator.ts`
- `apps/server/src/wsServer.ts`
- `apps/server/src/codexAppServerManager.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/git/Layers/GitCore.ts`

### Persistence

- `apps/server/src/persistence/Migrations/014_ProjectionThreadSubagentRuns.ts`
- `apps/server/src/persistence/Layers/ProjectionThreadSubagentRuns.ts`
- `apps/server/src/persistence/Services/ProjectionThreadSubagentRuns.ts`

### Web

- `apps/web/src/composer-logic.ts`
- `apps/web/src/components/chat/ComposerCommandMenu.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/SubagentReportCard.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/session-logic.ts`

## Status Model

`SubagentRun.status` currently uses:

- `preparing`
- `running`
- `report_ready`
- `accepted`
- `retained`
- `cleaned_up`
- `failed`
- `cleanup_failed`

## Cleanup Rules

- Clean worktree after report acceptance: can be auto-cleaned.
- Dirty worktree after report acceptance: retained until explicit discard.
- If cleanup runs after a visible worktree thread was opened, that visible thread is detached from the removed worktree.
- If sidebar thread deletion tries to remove a worktree path that is already gone, `GitCore.removeWorktree` now treats that as a no-op.

## Known Design Choices

- The hidden sub-agent conversation remains server-side state and is not replayed into the main thread.
- The visible thread opened from a sub-agent worktree starts with normal visible-thread history, not the hidden sub-agent transcript.
- The parent thread only receives the distilled report card.
- The server uses turn quiescence and orchestration projections, not file watching, to finalize reports.

## If You Want To Extend This

Common next steps:

- improve report synthesis quality and strictness
- support richer skill metadata beyond `SKILL.md`
- add branch merge/apply UX for retained sub-agent worktrees
- add explicit UI state for detached former worktree threads
- support providers beyond Codex

## Verification

This implementation was verified with:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
