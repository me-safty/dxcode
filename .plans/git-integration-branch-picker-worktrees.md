# Git Branch Picker and Worktree Integration

Status: **Completed and superseded by VCS/orchestration architecture**
Last reviewed: 2026-07-13

## Original intent

Add desktop IPC methods and renderer fields so new threads could target a branch or an isolated Git worktree.

## Current state

The feature is now server-owned and cross-client:

- VCS wire contracts live in `packages/contracts/src/vcs.ts` and Git-specific compatibility contracts in `packages/contracts/src/git.ts`.
- server drivers and provisioning live in `apps/server/src/vcs`.
- durable project/thread/worktree state is represented through orchestration contracts and projections.
- `packages/client-runtime/src/state/vcs*.ts` coordinates commands and reactive status for web and mobile.
- web composer controls operate on draft-thread state before promotion to a durable thread.

## Invariants

- Never derive a worktree path by unsafely interpolating a branch name.
- Provisioning validates repository identity, ref existence, target path, and linked-worktree conflicts.
- A failed Git operation leaves no durable half-created thread and no stale optimistic UI state.
- Removing a worktree cannot escape the intended repository/worktree roots.
- Branch and worktree state is refreshed after mutations and restored after reconnect.
- Local VCS behavior remains independent of hosted source-control providers.

## Validation

Run VCS provisioning, orchestration, client-runtime, and composer tests with `vp test`, then the repository baseline.
