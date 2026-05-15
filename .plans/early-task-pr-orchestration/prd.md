# Early Task PR Orchestration PRD

## Problem

The Task Intake MVP can accept Slack and Linear requests, create a Task, materialize a T3 worktree/branch/thread, and continue follow-up chat. The next missing user-visible milestone is a GitHub PR that appears automatically for the Task so the requester can track work without opening T3.

The desired behavior is "create the PR in the background right after the worktree and branch are created." In practice, GitHub PRs need a pushed branch with commits or at least a comparable head. The product behavior should therefore start PR orchestration immediately after runtime materialization, then create or reuse the draft PR as soon as the branch has changes that can be committed and pushed.

## Goals

- Start PR orchestration automatically for every Task after T3 materializes a worktree and branch.
- Reuse existing T3 Git/GitHub services for commits, branch push, existing PR lookup, and PR creation.
- Store the created GitHub PR as a Task external link in Convex.
- Send simple Slack/Linear replies when the PR is created or when PR setup fails.
- Keep the implementation backend-only and source-agnostic so future intakes can reuse it.
- Minimize changes inside existing T3 runtime code to reduce future merge conflicts.

## Non-Goals

- No UI changes.
- No streaming agent output into Slack, Linear, or GitHub.
- No GitHub review lifecycle automation beyond creating or finding a draft PR.
- No fake empty commits just to force an immediate PR.
- No broad T3 GitManager refactor unless a small extraction is needed to reuse existing behavior cleanly.
- No sandbox work in this slice.

## User Stories

- As a requester in Slack, I can ask the Engineering Agent to do a task and later receive a PR link in the same thread.
- As a requester in Linear, I can create/comment on an issue and later receive a PR link on that issue.
- As an operator, I can inspect Convex Task events and external links to understand whether PR creation is waiting, succeeded, or failed.
- As an engineer, I can add another intake source later without rewriting PR orchestration.

## Requirements

- PR orchestration is idempotent per Task/work session/branch.
- If a PR already exists for the branch, the system records and replies with that PR instead of creating a duplicate.
- If the branch has no changes yet, PR orchestration records `waiting_for_changes` and retries on later task lifecycle signals.
- If the worktree has changes but no commit, the T3 bridge can use existing commit generation and Git push behavior to prepare the branch for a PR.
- Created PRs should be draft PRs for the MVP.
- Source replies should be coarse lifecycle updates only.

## Open Questions

- Should the first PR body be generated from the original intake prompt only, or should it include a short task event summary when available?
- Should completion mark the draft PR ready for review, or should that remain a separate future workflow?
- Should PR orchestration run only on lifecycle callbacks, or should it also have a scheduled retry for long-running work?
