# Git and VCS Integration Tests

Status: **Completed and superseded by server VCS tests**
Last reviewed: 2026-07-13

## Current test homes

Git logic no longer lives in Electron `main.ts`. Coverage is colocated with:

- `apps/server/src/vcs/GitVcsDriverCore.test.ts`
- `apps/server/src/vcs/GitVcsDriver.test.ts`
- `apps/server/src/vcs/VcsDriverRegistry.test.ts`
- `apps/server/src/vcs/VcsProvisioningService.test.ts`
- `apps/server/src/git/GitManager.test.ts`
- cross-client VCS action/state tests in `packages/client-runtime/src/state`

## Integration strategy

- Use a fresh temporary repository for each scenario.
- Configure test-local author identity and create explicit commits/branches/remotes.
- Exercise real Git commands for detection, refs, status, checkout, worktrees, remotes, and failure classification.
- Keep hosted-provider API behavior in source-control provider tests.
- Test cancellation, timeout, output limits, dirty-worktree conflicts, linked-worktree conflicts, path quoting, and cleanup.
- Make tests platform-aware without weakening core assertions.

## Validation

Run focused VCS/Git tests with `vp test`, then the repository baseline.
