# Early Task PR Orchestration Implementation Plan

> [!IMPORTANT]
> **Instructions for Agents**
>
> This plan is executed phase-by-phase. After completing each phase:
>
> 1. Update **Implementation Notes** with deviations, decisions, and surprises.
> 2. Update **Implementation Footprint** with files created and modified.
> 3. Check off **Acceptance Criteria** only after verification.
>
> Required completion checks: `bun fmt`, `bun lint`, and `bun typecheck`.
> Use `bun run test`, never `bun test`.
>
> Keep this slice narrow. Convex owns Task/PR orchestration state. T3 owns local git/runtime behavior. Prefer small bridge endpoints and small helper extraction over broad T3 refactors.

## Source Documents

- [PRD](./prd.md)
- [Task Intake MVP Plan](../ai-engineer-task-orchestrator/plan.md)
- [Domain Context](../../CONTEXT.md)
- [ADR 0002: Convex owns Task state, T3 owns runtime state](../../docs/adr/0002-convex-owns-task-state-t3-owns-runtime-state.md)
- [AGENTS.md](../../AGENTS.md)

## MVP Boundary

In scope:

- Start a background PR setup flow after Task runtime materialization.
- Create or find a draft GitHub PR for the Task branch once the branch has changes.
- Commit and push via existing T3 Git/GitHub services when changes exist and no pushed commit exists yet.
- Store the GitHub PR as a Convex `taskExternalLinks` record with kind `github_pr`.
- Record PR orchestration events for auditability.
- Send simple Slack/Linear replies when a PR is created or PR setup fails.

Out of scope:

- UI changes.
- GitHub review lifecycle, merge, status checks, labels, reviewers, or ready-for-review transitions.
- Streaming coding-agent output to Slack, Linear, or GitHub.
- Fake empty commits to force an immediate PR.
- Sandbox implementation.
- A generic GitHub automation platform.

## Architecture

### Ownership Boundary

Convex is the source of truth for Task orchestration:

- task state
- work session state
- external links
- PR orchestration status/events
- source replies

T3 is the source of truth for local execution mechanics:

- resolving the local project
- worktree and branch paths
- git status/commit/push
- GitHub CLI PR lookup and creation
- provider thread execution

The integration point should be a narrow execution bridge contract in `packages/contracts/src/executionBridge.ts`, plus one T3 HTTP bridge endpoint. This keeps future intake sources independent of GitHub mechanics and keeps T3 mostly untouched.

### PR Timing

The system should schedule PR setup immediately after worktree/branch materialization, but it should not create a fake commit. If there is no commit or diff yet, the first PR attempt returns `waiting_for_changes`. Later lifecycle signals retry the same idempotent PR setup. Once changes exist, the T3 bridge prepares the branch, pushes it, creates or finds the draft PR, and returns the PR metadata to Convex.

### Durable Link Identity

Use `taskExternalLinks` for the GitHub PR:

- `kind`: `github_pr`
- `externalId`: stable GitHub PR identity, preferably `owner/repo#number`
- `url`: canonical PR URL

The Task should have at most one `github_pr` external link for this MVP. Idempotency should tolerate repeated bridge calls and repeated Convex lifecycle events.

## Phase 1: PR Contracts And Convex State

**Blocked by**: Completed Task Intake MVP

**User stories**:

- As an operator, I can see whether a Task is waiting for changes, has a PR, or failed PR setup.
- As a developer, I can reason about the Convex-to-T3 PR bridge through schema-only contracts.

**What to build**:

Add contract-first PR orchestration shapes and minimal Convex functions/events. Do not add a separate PR table unless the event/link model proves insufficient during implementation.

**Implementation steps**:

1. Add schema-only PR bridge contracts in `packages/contracts/src/executionBridge.ts`.
2. Model request fields around the existing materialized runtime: `taskId`, `workSessionId`, `branch`, `worktreePath`, project/repo metadata, title/body seeds, and `idempotencyKey`.
3. Model response statuses: `waiting_for_changes`, `created`, `existing`, and `failed`.
4. Add response PR metadata for `created`/`existing`: owner, repo, number, url, head branch, base branch, draft flag.
5. Add Convex internal mutation/action helpers to record PR events and upsert the `github_pr` external link.
6. Keep PR status as Task Events plus External Link for MVP. Add a table only if implementation needs durable retry locking that cannot be represented safely otherwise.
7. Add focused contract and Convex/domain tests.

**Acceptance criteria**:

- [x] PR bridge request/response contracts exist in `packages/contracts`.
- [x] Contracts are exported from the package.
- [x] Convex can record `task-pr.requested`, `task-pr.waiting-for-changes`, `task-pr.created`, and `task-pr.failed` events.
- [x] Convex can upsert one `github_pr` External Link for a Task idempotently.
- [ ] Tests cover contract decoding and idempotent PR link/event handling.
- [x] `bun fmt`, `bun lint`, and `bun typecheck` pass.

**References**:

- `packages/contracts/src/executionBridge.ts`
- `apps/orchestrator/convex/taskExternalLinks.ts`
- `apps/orchestrator/convex/taskEvents.ts`
- `apps/orchestrator/convex/t3Runtime.ts`

**Implementation Notes**:

- Prefer extending existing execution bridge contracts over introducing another top-level contract namespace.
- Added `TaskPullRequestEnsureRequest`, `TaskPullRequestMetadata`, and `TaskPullRequestEnsureResponse` to the existing execution bridge contract namespace.
- Kept PR orchestration state in Task Events plus `taskExternalLinks` with `kind: "github_pr"`; no separate PR table was needed for this MVP pass.
- The Convex record path uses stable event keys derived from task id, work session id, branch, and result status, and upserts PR links by `owner/repo#number`.
- Contract decoding is covered by focused tests. Convex idempotency is implemented in mutations but still needs Convex-function-level tests.

**Implementation Footprint**:

- `packages/contracts/src/executionBridge.ts`
- `packages/contracts/src/executionBridge.test.ts`
- `apps/orchestrator/convex/t3Runtime.ts`
- `apps/orchestrator/convex/_generated/api.d.ts`
- `apps/orchestrator/convex/_generated/dataModel.d.ts`

## Phase 2: Schedule PR Setup After Runtime Materialization

**Blocked by**: Phase 1

**User stories**:

- As a requester, I do not need to ask separately for a PR.
- As an operator, I can see that PR setup started even if the branch is not ready yet.

**What to build**:

After T3 returns a materialized worktree/branch, Convex should enqueue or invoke the PR setup flow in the background. The task acceptance path should remain responsive.

**Implementation steps**:

1. Hook PR setup from the runtime materialization success path after branch and worktree path are recorded.
2. Require both `branch` and `worktreePath`; otherwise record a PR skipped/failed event with a useful reason.
3. Use an idempotency key derived from Task id, work session id, and branch.
4. Call the T3 PR bridge through `apps/orchestrator/src/t3/client.ts`.
5. Record `waiting_for_changes` without treating it as failure.
6. Ensure duplicate materialization callbacks do not schedule duplicate PR creation side effects.
7. Add tests around materialization-to-PR scheduling with duplicate events.

**Acceptance criteria**:

- [x] Runtime materialization success starts PR setup automatically.
- [x] Missing branch/worktree records a clear event and does not crash intake.
- [x] Duplicate materialization does not create duplicate PR links or duplicate source replies.
- [x] `waiting_for_changes` is recorded as a normal intermediate state.
- [x] Task acceptance replies are not blocked on slow GitHub operations.
- [x] `bun fmt`, `bun lint`, and `bun typecheck` pass.

**References**:

- `apps/orchestrator/convex/t3Runtime.ts`
- `apps/orchestrator/src/t3/client.ts`
- `apps/orchestrator/src/taskIntake/ingress.ts`

**Implementation Notes**:

- If Convex scheduling primitives make true background execution awkward, keep the behavior logically backgrounded by separating the accepted intake response from the later PR reply.
- `materializeTaskRuntime` now schedules `api.t3Runtime.ensureTaskPullRequest` with `ctx.scheduler.runAfter(0, ...)` after runtime records are persisted.
- Follow-up continuation acceptance also schedules the same idempotent PR ensure action, so later user messages can trigger a retry once changes exist.
- If the Task does not yet have branch/worktree materialization, PR ensure returns `skipped` rather than crashing the intake path.

**Implementation Footprint**:

- `apps/orchestrator/convex/t3Runtime.ts`
- `apps/orchestrator/src/t3/client.ts`
- `apps/orchestrator/convex/_generated/api.d.ts`

## Phase 3: T3 PR Bridge Endpoint

**Blocked by**: Phase 1

**User stories**:

- As an engineer, PR creation reuses the same GitHub behavior already used by T3's manual Git actions.
- As a maintainer, T3 changes stay small and easy to rebase.

**What to build**:

Add a narrow T3 execution bridge endpoint that prepares a Task branch for a draft PR and returns structured status. Reuse existing `GitVcsDriver`, source-control provider, and `GitManager` logic wherever practical.

**Implementation steps**:

1. Add a route such as `POST /api/tasks/pull-request/ensure` in the execution bridge HTTP layer.
2. Decode the new PR bridge request contract.
3. Validate `worktreePath` and branch against the local project/worktree state.
4. Check for an existing PR for the head branch before creating anything.
5. If no changes/commits exist relative to base, return `waiting_for_changes`.
6. If changes exist but are uncommitted, reuse existing commit generation behavior rather than duplicating prompt/title logic.
7. Push the branch using existing git push behavior.
8. Create a draft PR using existing GitHub CLI behavior, or return the existing PR if another retry already created it.
9. Add focused server tests with fake Git/GitHub services.

**Acceptance criteria**:

- [x] T3 exposes one PR ensure bridge endpoint.
- [x] Existing PR lookup prevents duplicate PRs.
- [x] No-diff branches return `waiting_for_changes`.
- [x] Dirty worktrees can be committed and pushed through existing T3 git services.
- [x] Created PRs are draft PRs.
- [ ] Server tests cover existing PR, waiting for changes, successful create, and failure.
- [x] `bun fmt`, `bun lint`, and `bun typecheck` pass.

**References**:

- `apps/server/src/executionBridge/http.ts`
- `apps/server/src/executionBridge/runStart.ts`
- `apps/server/src/vcs/GitVcsDriver.ts`
- `apps/server/src/sourceControl/GitHubCli.ts`
- `apps/server/src/sourceControl/SourceControlProvider.ts`
- `apps/server/src/git/GitManager.ts`
- `apps/server/src/git/GitManager.test.ts`

**Implementation Notes**:

- The preferred path is a small helper that calls existing GitManager/VCS services. If GitManager is too UI-command-shaped, extract only the smallest reusable commit/push/create-pr helper.
- Avoid changing WebSocket Git behavior for this MVP.
- Added `POST /api/tasks/pull-request/ensure` behind the existing execution bridge bearer auth.
- The bridge validates that the task worktree is on the expected branch and returns structured `failed` responses instead of throwing for expected PR setup failures.
- Reused `GitManager.runStackedAction` for commit, push, existing-PR lookup, and PR creation. The UI-facing git action contract was not expanded.
- Added an internal-only `draftPullRequest` option on `GitRunStackedActionOptions` and threaded `draft?: boolean` through the source-control provider into `GitHubCli.createPullRequest`, which appends `--draft` for task PRs.
- Focused GitManager tests cover draft PR creation and existing PR behavior; direct bridge tests for waiting/failure remain follow-up coverage.

**Implementation Footprint**:

- `apps/server/src/executionBridge/http.ts`
- `apps/server/src/executionBridge/runStart.ts`
- `apps/server/src/server.ts`
- `apps/server/src/sourceControl/GitHubCli.ts`
- `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`
- `apps/server/src/sourceControl/SourceControlProvider.ts`
- `apps/server/src/git/GitManager.ts`
- `apps/server/src/git/GitManager.test.ts`

## Phase 4: Retry, Lifecycle, And Source Replies

**Blocked by**: Phase 2, Phase 3

**User stories**:

- As a requester, I get the PR link in Slack/Linear once it exists.
- As an operator, retries are understandable and failures are visible.

**What to build**:

Retry PR setup on useful Task lifecycle events and send simple source replies when the PR is created or fails.

**Implementation steps**:

1. Trigger idempotent PR ensure after runtime lifecycle events that imply changes may exist, especially turn completion/task completion.
2. Trigger idempotent PR ensure after follow-up messages are accepted into an existing T3 thread if the Task does not yet have a PR.
3. On `created` or `existing`, upsert the `github_pr` link and post a Slack/Linear reply with the PR URL.
4. Ensure the PR-created reply is sent once per source conversation.
5. On terminal PR failure, record `task-pr.failed` and post a short failure reply.
6. If a Task completion reply is sent after a PR exists, include the PR URL in that completion reply when easy; otherwise allow the earlier PR reply to stand alone.
7. Add tests for source reply idempotency.

**Acceptance criteria**:

- [x] PR setup retries when a task turn/lifecycle suggests changes may now exist.
- [ ] Slack receives a single PR-created reply in the original thread.
- [ ] Linear receives a single PR-created comment on the original issue.
- [x] PR failures are recorded and replied without crashing task lifecycle handling.
- [x] Completion replies include the PR URL when available.
- [x] `bun fmt`, `bun lint`, and `bun typecheck` pass.

**References**:

- `apps/orchestrator/src/taskIntake/replies.ts`
- `apps/orchestrator/src/taskIntake/ingress.ts`
- `apps/orchestrator/convex/t3Runtime.ts`
- `apps/orchestrator/convex/taskEvents.ts`

**Implementation Notes**:

- Keep replies coarse. Do not stream progress.
- Treat Linear and Slack as delivery adapters; PR policy belongs in shared orchestration code.
- Runtime terminal callbacks now run PR ensure before claiming lifecycle replies, so completion/failure replies can include a stored PR URL when one exists.
- This pass does not add a separate "PR created" source reply; the PR link is included in the coarse terminal lifecycle reply. Live Slack/Linear E2E should decide whether a separate non-terminal PR-created message is still needed.
- Source reply idempotency continues to use the existing lifecycle reply claim keys, now with PR URL composition pulled from `github_pr` external links.

**Implementation Footprint**:

- `apps/orchestrator/convex/http.ts`
- `apps/orchestrator/convex/taskEvents.ts`
- `apps/orchestrator/src/taskIntake/lifecycleReplies.test.ts`

## Phase 5: Live E2E

**Blocked by**: Phase 4

**User stories**:

- As the product owner, I can see the whole path work from Slack and Linear without manual database edits.

**What to build**:

Run one final live test for Slack and one for Linear using the dev Convex deployment and local T3 bridge/tunnel.

**Live E2E setup**:

1. Confirm the worktree is on the implementation branch and the intended changes are committed or intentionally left dirty for the test.
2. Run required local checks before live testing:
   - `bun fmt`
   - `bun lint`
   - `bun typecheck`
   - focused `bun run test -- ...` commands for contracts, orchestrator, and server PR bridge tests
3. Start the local T3 server with the execution bridge enabled.
4. Start a temporary tunnel to the local T3 bridge.
5. Set `T3_EXECUTION_BRIDGE_BASE_URL` on the dev Convex deployment only for the test window.
6. Deploy or run Convex functions against the same dev deployment receiving Slack/Linear webhooks.
7. Confirm the configured workspace root points at the intended local checkout and not a stale production path.
8. Confirm GitHub CLI auth can push branches and create draft PRs from the local machine.

**Slack E2E test**:

1. In Slack `#testing`, mention the Engineering Agent with a request that makes a tiny, easy-to-verify repo change.
2. Confirm Slack receives the accepted/started reply.
3. Confirm Convex creates a Task with a Slack External Link and records runtime materialization.
4. Confirm T3 creates:
   - a branch with the Task-derived name
   - a worktree under the configured worktree root
   - one primary T3 thread
5. Send one Slack follow-up in the same thread and confirm it routes to the same Task/T3 thread.
6. Wait for PR orchestration to run.
7. Confirm GitHub has a draft PR for the Task branch.
8. Confirm Convex stores a `github_pr` External Link for the Task.
9. Confirm Slack receives exactly one PR-created reply in the original thread.

**Linear E2E test**:

1. Create or reuse a Linear test issue and mention/request the Engineering Agent with a tiny, easy-to-verify repo change.
2. Confirm Linear receives the accepted/started comment.
3. Confirm Convex creates a Task with a Linear External Link and records runtime materialization.
4. Confirm T3 creates:
   - a branch with the Task-derived name
   - a worktree under the configured worktree root
   - one primary T3 thread
5. Add one Linear follow-up comment and confirm it routes to the same Task/T3 thread.
6. Wait for PR orchestration to run.
7. Confirm GitHub has a draft PR for the Task branch.
8. Confirm Convex stores a `github_pr` External Link for the Task.
9. Confirm Linear receives exactly one PR-created comment on the issue.

**Manual verification commands/checks**:

1. Use Convex dashboard or CLI to inspect the Task, Task Events, Work Session, Task Thread, and External Links.
2. Use `git -C <worktreePath> status --short --branch` to confirm the branch/worktree state.
3. Use `gh pr view --repo <owner>/<repo> --json number,url,state,isDraft,headRefName,baseRefName` to confirm the PR.
4. Use Slack and Linear thread history to confirm replies are present and not duplicated.

**Cleanup**:

1. Remove `T3_EXECUTION_BRIDGE_BASE_URL` from the dev Convex deployment after testing.
2. Stop the local tunnel and T3 server.
3. Close or label test PRs so they are easy to distinguish from real work.
4. Keep test branches/worktrees only if useful for debugging; otherwise clean them up intentionally.
5. Update this plan with exact Task ids, thread ids, branches, worktree paths, PR URLs, and cleanup notes.

**Implementation steps**:

1. Deploy or run Convex functions against the intended dev deployment.
2. Start the local T3 server and bridge tunnel.
3. Configure `T3_EXECUTION_BRIDGE_BASE_URL` only for the test window.
4. Create a Slack `#testing` request and confirm Task creation, branch/worktree/thread creation, follow-up chat, PR setup, and PR reply.
5. Create or use a Linear test issue and confirm the same path.
6. Confirm the GitHub PR link is stored as `github_pr` in Convex.
7. Clean up temporary bridge env vars/tunnels after the test.
8. Update this plan with exact task ids, thread ids, branches, PR URLs, and cleanup notes.

**Acceptance criteria**:

- [x] Slack E2E creates/continues a Task and receives a PR link.
- [ ] Linear E2E creates/continues a Task and receives a PR link.
- [x] T3 creates the branch and worktree for each live Task.
- [x] GitHub has a draft PR for each live Task branch, or one shared test PR if the test scope is intentionally narrowed.
- [x] Convex stores `github_pr` External Links.
- [x] Temporary live-test env vars/tunnels are cleaned up.
- [x] `bun fmt`, `bun lint`, and `bun typecheck` pass after final edits.

**References**:

- Slack `#testing`
- Linear test issue/project
- Convex dev deployment
- Local T3 bridge

**Implementation Notes**:

- Do not leave dev/prod Convex pointing at a stale local tunnel.
- 2026-05-03 Slack E2E used dev Convex `https://scrupulous-fly-947.convex.site`,
  local bridge `127.0.0.1:4773`, and a temporary ngrok tunnel.
- Initial Slack run exposed two production-path bugs before the final successful retry:
  empty upstream task branches could call `gh pr create` instead of returning
  `waiting_for_changes`, and `gh` resolved the current repository as `pingdotgg/t3code`
  in a checkout with both `origin` and `upstream`. The fix now guards PR-only runs by
  checking committed changes against the project default branch and passes the project
  repository through the source-control provider for task PR actions.
- First diagnostic Task: `kn70ebh0yq5s7387q1v25nf2md8610c1`, Work Session
  `ks72jtc9bhzgxggc8pd25gytrs861mkc`, T3 Thread
  `3fb553c3-d010-458e-a65d-c5e1bb4792d1`, branch
  `task/u0b0t56ay7r-live-e2e-for-pr-orchestration-please-q1v25nf2md8610c1`.
  Manual repository-qualified retry produced a draft PR
  and Convex recorded it as `github_pr`.
- Clean patched Slack E2E Task: `kn7a95bnfv88aedr54a8924wcd860nan`, Work Session
  `ks78k5dpwaenwy763s5tkmbt3n8609bp`, T3 Thread
  `60fe4440-6ab2-48e0-a22c-7157e554f938`, branch
  `task/u0b0t56ay7r-live-e2e-retry-for-patched-pr-orches-54a8924wcd860nan`.
  Slack thread `1777795467.003019` received the terminal completion reply with draft PR
  and Convex stored the external link.
- Cleanup completed: removed dev Convex `T3_EXECUTION_BRIDGE_BASE_URL`, stopped the local
  T3 bridge on `127.0.0.1:4773`, stopped the ngrok tunnel, and stopped the Convex log tail
  started for this E2E run.
- Linear E2E remains intentionally unrun in this pass; the user requested live Slack E2E.

**Implementation Footprint**:

- `.plans/early-task-pr-orchestration/plan.md`
- `apps/server/src/executionBridge/runStart.ts`
- `apps/server/src/executionBridge/runStart.materialize.test.ts`
- `apps/server/src/git/GitManager.ts`
- `apps/server/src/sourceControl/GitHubCli.ts`
- `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`
- `packages/contracts/src/git.ts`
