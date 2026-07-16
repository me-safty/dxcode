# Branch and Environment Selection in the Composer

Status: **Completed and superseded by draft-thread/VCS state**
Last reviewed: 2026-07-13

## Original intent

Let a user choose a branch and local-versus-worktree environment before the first message.

## Current state

The feature no longer depends on renderer-local reducer state or React Query:

- branch/ref and worktree state is typed in `packages/contracts` and managed through `packages/client-runtime/src/state/vcs*.ts`
- server operations go through `apps/server/src/vcs` and orchestration commands
- composer drafts and draft-thread promotion live in `apps/web/src/composerDraftStore.ts` and `ChatView.tsx`
- Atom-backed state in `apps/web/src/state/vcs.ts` feeds the current composer controls
- durable thread/worktree identity is server-authoritative

## UX invariants

- The selected base ref and environment mode are explicit before thread creation.
- Worktree provisioning is transactional from the user's perspective: a failed provision does not create a half-configured thread.
- Once work has started, changes that would invalidate the running workspace are disabled or require an explicit new thread.
- Non-repository projects degrade gracefully.
- Reconnect restores the server-authoritative thread/worktree state rather than stale component state.

## Validation

Cover local and worktree creation, provisioning failure, non-repository behavior, reconnect, and draft promotion with `vp test`, then run the repository baseline.
