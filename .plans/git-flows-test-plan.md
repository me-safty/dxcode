# Branch and Worktree Flow Tests

Status: **Completed and superseded by orchestration/client-runtime coverage**
Last reviewed: 2026-07-13

## Current ownership

The old renderer reducer simulation is no longer representative. Branch and worktree flows cross:

- VCS services in `apps/server/src/vcs`
- orchestration commands/events and projections in `apps/server/src/orchestration`
- cross-client VCS atoms/actions in `packages/client-runtime/src/state`
- web composer draft promotion and controls in `apps/web`

## Required scenarios

- initialize/detect repository and resolve current/default refs
- create or select a branch for a new thread
- provision and remove an isolated worktree
- reject dirty/conflicting operations with typed, actionable errors
- keep multiple threads/environments isolated
- recover server-authoritative branch/worktree state after reconnect
- avoid creating a thread when provisioning fails
- serialize conflicting VCS commands and refresh only the affected repository state

Pure reducers/selectors should use table-driven unit tests. Filesystem semantics should use real temporary Git repositories. UI tests should assert visible state and disabled/enabled actions rather than implementation-specific dispatch sequences.

## Validation

Run affected tests with `vp test`, then the repository baseline.
