# Source Control Panel Implementation Plan

## Status

This plan tracks a planned source-control panel for T3 Code. The goal is a VS Code-inspired source-control surface inside T3 Code that makes repository state, file changes, review, commit, sync, branch, stash, remote, compare, and worktree actions available without leaving the conversation workspace.

The current codebase already has important pieces:

- Server-side VCS and source-control services under `apps/server/src/vcs`, `apps/server/src/git`, and `apps/server/src/sourceControl`.
- Shared contracts for VCS status, refs, Git actions, source-control provider discovery, and repository operations under `packages/contracts`.
- Client runtime state managers for VCS status, refs, actions, and source-control discovery under `packages/client-runtime`.
- A compact chat-header Git action control in `apps/web/src/components/GitActionsControl.tsx`.
- VS Code extension UI defaults that intentionally hide T3 Code controls duplicated by native VS Code source-control UI.

The feature should consolidate those primitives into a first-class right-panel surface instead of expanding the chat-header control into a dense menu.

## Target Behavior

The source-control panel should become the primary T3 Code surface for repository state and source-control operations, implemented as an additional type in the existing thread-scoped right panel.

Expected behavior:

- A user can open a source-control panel only by opening the existing right panel and choosing the source-control surface. The feature should not add new explicit controls to the main chat header, project sidebar, conversation timeline, or other primary UI chrome.
- The panel is scoped to the active thread's environment and executable workspace root.
- The panel shows repository identity, current branch/ref, upstream state, primary remote/provider, open change request state, and pending working-tree changes.
- Changed files are grouped in VS Code-style sections for unstaged changes, staged changes, conflicts, and optionally untracked/ignored visibility once the backend exposes those categories.
- Users can review file diffs inline, open files in the preferred editor, stage/unstage files, stash or discard staged/unstaged/all changes with confirmation, and commit selected or staged changes.
- Users can fetch, pull, push, publish, merge, delete, rename, open branches on remote, create branches/tags from commits, revert or check out commits, and create/remove/switch worktrees through the same action layer already used elsewhere.
- Users can inspect remotes, add remotes, fetch individual or all remotes, remove remotes, list branches per remote, and create/switch local branches from remote refs.
- Users can inspect stashes, apply/pop/rename/drop them, compare them against another branch or the working tree, and copy stash identity/message details.
- Users can open a graph view for the current branch's commits, see local versus synced-upstream state, and see where other branch heads and tags point in the same commit history.
- Users can compare the working tree, a branch, or a stash against another selectable branch or working tree. The default compare target should be the inferred base branch for the current branch when known, otherwise the repository default branch.
- Long-running operations show progress in the panel and existing toast/progress channels, including hook output when available.
- Status updates remain live while the panel is open and are refreshed on focus, visibility changes, command completion, checkpoint updates, and provider command completion.
- Non-repository folders show an initialize/publish path instead of empty Git actions.
- Missing Git/provider tooling routes to source-control settings and discovery guidance rather than presenting dead controls.
- VS Code extension hosts should expose a host display setting to show or hide the T3 Code source-control panel. When enabled, the extension presents the same T3 Code functionality that desktop would present; when disabled, it hides the panel. The extension should not override, replace, or fork T3 Code source-control behavior.

## Assessment

The existing implementation is action-oriented rather than panel-oriented. `GitActionsControl.tsx` already knows how to resolve quick actions, run stacked Git actions, commit selected files, publish repositories, and open pull requests. The current UI is useful for compact header access, but it is too compressed to become a durable source-control workspace.

The most important implementation choice is that the panel should reuse the existing VCS status/action/discovery contracts and only add missing backend capabilities where the contract is currently too coarse. The source-control panel should not directly shell out from the browser, should not duplicate Git command orchestration in React, and should not introduce a second status subscription model.

## Reference Behavior

VS Code's source-control UX is the product reference, not a strict clone.

Reference concepts to carry over:

- Source Control is a persistent view, not only a toolbar menu.
- The Activity Bar badge communicates the number of affected files.
- Changes are grouped by staging state, with a clear commit-message input and primary commit action.
- File rows expose quick stage/unstage actions and open diff review.
- Diff review can stage more granular hunks or selected ranges.
- Sync state shows incoming/outgoing commits and gives users obvious pull/push/sync operations.
- Branch, worktree, stash, conflict, and provider-specific actions live behind progressively disclosed menus.
- Source-control output/logs are available when operations fail.

T3 Code should adapt those ideas to its own layout: agent conversation stays primary, while source control becomes a focused operational panel that can be opened when repository state needs attention.

## Right Panel Integration

The source-control UI should be implemented inside the existing right-panel system as a new panel surface type, not as a new global page or a new primary-layout control.

Current implementation reference points:

- `apps/web/src/rightPanelStore.ts` owns `RightPanelKind`, `RightPanelSurface`, right-panel persistence, activation, and singleton surfaces such as `diff` and `plan`.
- `apps/web/src/components/RightPanelTabs.tsx` renders the right-panel tab strip and its "Add panel surface" menu.
- `apps/web/src/components/ChatView.tsx` renders the active right-panel surface for inline and sheet layouts.

Planned behavior:

- Add a right-panel kind such as `"source-control"` and a singleton surface descriptor such as `{ id: "source-control", kind: "source-control" }`.
- Add source control to the right-panel surface picker/menu when the active thread has a source-control-capable workspace. The right panel's existing toggle remains the entry point.
- Render `SourceControlPanel` only when `activeRightPanelSurface.kind === "source-control"`.
- Preserve per-thread right-panel persistence so a thread can reopen with the source-control surface active, following the same pattern as existing singleton surfaces.
- Keep all detailed source-control controls inside `SourceControlPanel`. The main UI should not gain separate branch, graph, stash, remote, compare, or commit controls for this feature.
- Do not move the existing compact `GitActionsControl` scope into the main UI as part of this feature. If it remains, it should stay compact and existing; the comprehensive functionality belongs only to the source-control right-panel surface.
- In VS Code webviews, `t3code.ui.enableSourceControlPanel` should determine whether the source-control right-panel surface is offered in the right-panel surface picker and whether an already-persisted source-control surface is rendered or ignored.

## Functional Scope

The panel should be organized around reusable VCS entities rather than one-off screens. Each entity should have a small, consistent summary row and a details expansion or route. The same entity component should be renderable in multiple contexts so improvements to commit, branch, stash, remote, and file rows apply everywhere.

### Working Tree

The working tree surface should answer "what is currently different?" and expose high-level actions.

Core capabilities:

- Show staged and unstaged files separately, including additions/deletions and file status.
- Stage or unstage individual files.
- Discard individual unstaged files with confirmation.
- Stash staged changes, unstaged changes, or both.
- Discard all staged changes, all unstaged changes, or both with explicit confirmation.
- Compare the working tree against another selectable branch, defaulting to the inferred base branch or repository default branch.
- Show ahead/behind context for the current branch alongside working-tree changes so users understand whether they should pull, push, or review local commits before acting.

Additional appropriate capabilities:

- Show conflicted files as a distinct priority group with merge-resolution guidance.
- Show generated/ignored-risk hints when available, such as large file counts, lockfiles, or files under ignored-but-tracked paths.
- Provide "copy summary" for staged/unstaged file lists so a user can paste status context into a prompt.

### Branches

Branch rows should summarize both identity and sync state.

Core capabilities:

- Fetch branch data from its remote.
- Pull with or without force.
- Push or publish with or without force.
- Merge into the current branch.
- Delete local branches with confirmation, and delete remote branches only through an explicit remote-scoped action.
- Rename local branches.
- Open branch on remote when a known provider URL exists.
- Copy HEAD SHA and HEAD commit message.
- Show ahead/behind counts against upstream and against the selected compare target.
- Show incoming/outgoing commit lists for the branch.
- Show the branch's recent commits using the shared commit item component.
- Highlight sync status, such as current, clean, ahead, behind, diverged, unpublished, stale remote, or gone upstream.

Additional appropriate capabilities:

- Mark protected/default branches and require an extra confirmation for risky actions.
- Offer "create worktree from branch" for parallel work.
- Offer "set upstream" when a local branch has a matching remote branch but no tracking relationship.
- Offer "copy branch name" and "copy remote URL" for quick command-line handoff.

### Commits

Commit rows should be useful anywhere a commit appears: graph view, branch details, incoming/outgoing lists, stash metadata, and compare results.

Core capabilities:

- Show commit message, author, avatar when available, relative time, short SHA, and useful labels.
- Highlight labels/tags for branches where the commit is currently HEAD, Git tags that point at the commit, remote-tracking refs, current `HEAD`, upstream base markers, and other useful ref decorations.
- Undo local commit when safe and when the commit is at the current branch tip.
- Revert a commit.
- Checkout a commit or create a branch/tag from it.
- Copy SHA and copy commit message.
- Open commit on remote when a known provider URL exists.

Additional appropriate capabilities:

- Show verification/build/provider metadata later if the source-control provider can supply it cheaply.
- Show changed-file count and additions/deletions for commit list rows when available without expensive diff loading.
- Keep destructive or history-rewriting actions behind capability checks and confirmations.

### Graph View

The graph should provide overview rather than a full Git log replacement.

Core capabilities:

- Show the current branch's commit history.
- Highlight commits that are local-only versus synced with upstream.
- Show incoming and outgoing ranges relative to upstream.
- Show other branch heads, remote-tracking branch heads, tags, and current `HEAD` decorations when those refs point at commits visible in the graph.
- Keep graph rendering bounded by an initial commit limit and support loading more.

Additional appropriate capabilities:

- Provide filters for local-only, incoming, outgoing, tagged, and branch-head commits.
- Allow selecting a commit to open reusable commit details and compare actions.
- Show a compact lane/relationship visualization only if it stays readable; avoid implementing a full advanced Git graph before the status workflows are solid.

### Stashes

Stash rows should behave like first-class saved work snapshots.

Core capabilities:

- List stashes with message, author when available, relative time, stash SHA/ref, and branch context.
- Apply, pop, rename, and drop stashes.
- Copy stash SHA/ref and message.
- Compare a stash against another selectable branch or the working tree.
- Show files included in the stash using the same file-change item model.

Additional appropriate capabilities:

- Create stash from staged-only, unstaged-only, or all changes.
- Include untracked files as an explicit option when creating a stash.
- Warn when applying/popping a stash onto a dirty working tree.

### Remotes

Remotes should expose repository-level connections without forcing users into terminal commands.

Core capabilities:

- Add, remove, and fetch remotes.
- Fetch all remotes.
- Show each remote's fetch and push URLs.
- Show provider identity when detected.
- Show the remote repository owner/company avatar when available, but treat this as optional provider metadata.
- For each remote row, show an expandable list of branches that can be fetched from that remote.
- For each remote branch, allow creating or switching to a local branch from that ref.

Additional appropriate capabilities:

- Rename remotes if the backend can do it safely.
- Copy fetch URL, push URL, and remote name.
- Show stale or pruned remote-tracking branches and offer a prune/fetch-prune action later.

### Compare Views

Compare should be a reusable view, not a branch-only feature.

Core capabilities:

- Compare current working tree against a selectable branch or working tree baseline.
- Compare branch against branch.
- Compare stash against branch or working tree.
- Show ahead/behind and file summaries before loading detailed diffs.
- Reuse file-change rows and commit rows inside compare results.

Additional appropriate capabilities:

- Provide quick compare targets: upstream, default branch, inferred base branch, previous branch, and working tree.
- Allow "copy compare summary" for prompt context.

## Planned Data Model

The first implementation should extend the existing VCS status model only where needed. A target shape for panel rendering is:

```ts
type SourceControlPanelSnapshot = {
  environmentId: EnvironmentId;
  cwd: string;
  repository: {
    isRepo: boolean;
    root: string | null;
    driver: "git" | "jj" | "unknown";
    provider: SourceControlProviderInfo | null;
    primaryRemoteUrl: string | null;
    remotes: SourceControlRemote[];
  };
  branch: {
    refName: string | null;
    isDefaultRef: boolean;
    hasUpstream: boolean;
    aheadCount: number;
    behindCount: number;
    aheadOfDefaultCount: number;
    inferredBaseRefName: string | null;
  };
  changeRequest: ChangeRequest | null;
  workingTree: {
    insertions: number;
    deletions: number;
    groups: SourceControlChangeGroup[];
    compareTarget: SourceControlCompareTarget | null;
  };
  branches: SourceControlBranch[];
  commits: SourceControlCommitSummary[];
  stashes: SourceControlStash[];
  graph: SourceControlGraphSummary | null;
  diagnostics: {
    lastRefreshError: string | null;
    lastOperationError: string | null;
  };
};

type SourceControlChangeGroup =
  | { kind: "unstaged"; files: SourceControlFileChange[] }
  | { kind: "staged"; files: SourceControlFileChange[] }
  | { kind: "conflicts"; files: SourceControlFileChange[] }
  | { kind: "untracked"; files: SourceControlFileChange[] };

type SourceControlFileChange = {
  path: string;
  originalPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted";
  insertions: number;
  deletions: number;
  staged: boolean;
};

type SourceControlRemote = {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
  provider: SourceControlProviderInfo | null;
  branches: SourceControlRemoteBranch[];
  lastFetchedAt: string | null;
};

type SourceControlRemoteBranch = {
  remoteName: string;
  name: string;
  fullRefName: string;
  tracksLocalRefName: string | null;
  isDefaultRemoteHead: boolean;
  latestCommitSha: string | null;
  syncStatus: SourceControlSyncStatus;
};

type SourceControlBranch = {
  name: string;
  fullRefName: string;
  remoteName: string | null;
  upstreamRefName: string | null;
  headSha: string | null;
  headMessage: string | null;
  isCurrent: boolean;
  isDefault: boolean;
  isProtected: boolean;
  syncStatus: SourceControlSyncStatus;
  aheadCount: number;
  behindCount: number;
  incomingCommits: SourceControlCommitSummary[];
  outgoingCommits: SourceControlCommitSummary[];
};

type SourceControlCommitSummary = {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  authoredAt: string | null;
  committedAt: string | null;
  relativeTimeLabel: string | null;
  refs: SourceControlCommitRefLabel[];
  stats: { files: number; insertions: number; deletions: number } | null;
  remoteUrl: string | null;
};

type SourceControlCommitRefLabel = {
  kind: "head" | "branch" | "remote-branch" | "tag" | "upstream" | "base";
  label: string;
};

type SourceControlStash = {
  refName: string;
  sha: string | null;
  message: string;
  branchName: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  createdAt: string | null;
  relativeTimeLabel: string | null;
  files: SourceControlFileChange[];
};

type SourceControlSyncStatus =
  | "clean"
  | "ahead"
  | "behind"
  | "diverged"
  | "unpublished"
  | "stale"
  | "gone"
  | "unknown";

type SourceControlCompareTarget =
  | { kind: "working-tree" }
  | { kind: "branch"; refName: string }
  | { kind: "stash"; refName: string }
  | { kind: "commit"; sha: string };

type SourceControlGraphSummary = {
  currentBranchName: string | null;
  commits: SourceControlCommitSummary[];
  hasMore: boolean;
  localOnlyCount: number;
  incomingCount: number;
  outgoingCount: number;
};
```

The existing `VcsStatusResult` can continue powering early panel work. The grouped shape should be added only once the backend can reliably distinguish staged, unstaged, untracked, and conflicted files without expensive repeated Git calls.

Commit, branch, stash, graph, and remote branch data should be loaded incrementally. The main status snapshot can include current repository state and high-level counts, while commit lists, graph ranges, stash file lists, and remote branch lists can be fetched on panel expansion or after explicit refresh/fetch actions so large repositories do not pay full history cost on every status update.

## Server Implementation Plan

1. Keep `VcsStatusBroadcaster` as the live status subscription authority. Add richer local status fields there only when the Git driver can compute them cheaply and consistently.

2. Extend the VCS driver boundary in `apps/server/src/vcs/VcsDriver.ts` and Git implementation in `apps/server/src/vcs/GitVcsDriver.ts` for staged/unstaged/conflict grouping, staged diff metadata, and file-level operations if those are not already exposed through current workflow services.

3. Add explicit RPCs for file-level operations rather than overloading stacked actions:

```ts
sourceControl.stageFiles({ cwd, paths });
sourceControl.unstageFiles({ cwd, paths });
sourceControl.discardFiles({ cwd, paths });
sourceControl.readFileDiff({ cwd, path, staged });
sourceControl.stashChanges({
  cwd,
  scope: "staged" | "unstaged" | "all",
  message,
  includeUntracked,
});
sourceControl.discardChanges({ cwd, scope: "staged" | "unstaged" | "all" });
```

4. Add explicit RPCs for branch and commit operations:

```ts
sourceControl.listBranches({ cwd });
sourceControl.fetchBranch({ cwd, branchName, remoteName });
sourceControl.pullBranch({ cwd, branchName, force });
sourceControl.pushBranch({ cwd, branchName, remoteName, force });
sourceControl.publishBranch({ cwd, branchName, remoteName, force });
sourceControl.mergeBranch({ cwd, sourceBranchName, targetBranchName });
sourceControl.deleteBranch({ cwd, branchName, remoteName });
sourceControl.renameBranch({ cwd, oldName, newName });
sourceControl.openBranchOnRemote({ cwd, branchName });
sourceControl.listCommits({ cwd, refName, range, limit, cursor });
sourceControl.undoCommit({ cwd, sha });
sourceControl.revertCommit({ cwd, sha });
sourceControl.checkoutCommit({ cwd, sha });
sourceControl.createBranchFromCommit({ cwd, sha, branchName });
sourceControl.createTagFromCommit({ cwd, sha, tagName });
sourceControl.openCommitOnRemote({ cwd, sha });
```

5. Add explicit RPCs for graph, stash, compare, and remote operations:

```ts
sourceControl.readGraph({ cwd, branchName, limit, cursor });
sourceControl.listStashes({ cwd });
sourceControl.applyStash({ cwd, stashRef });
sourceControl.popStash({ cwd, stashRef });
sourceControl.renameStash({ cwd, stashRef, message });
sourceControl.dropStash({ cwd, stashRef });
sourceControl.compare({ cwd, left, right });
sourceControl.listRemotes({ cwd });
sourceControl.addRemote({ cwd, name, url });
sourceControl.removeRemote({ cwd, name });
sourceControl.fetchRemote({ cwd, remoteName });
sourceControl.fetchAllRemotes({ cwd });
sourceControl.listRemoteBranches({ cwd, remoteName });
sourceControl.createBranchFromRemote({ cwd, remoteName, remoteBranchName, localBranchName });
sourceControl.switchRemoteBranch({ cwd, remoteName, remoteBranchName, localBranchName });
```

6. Gate destructive and history-changing operations. Discard, drop stash, delete branch, remove remote, force pull, force push, undo commit, revert commit, checkout commit, and merge should require capability checks, clear client confirmation where appropriate, repository-root containment checks for file operations, remote/branch/tag name validation, and command output/error reporting.

7. Reuse `GitManager` and `GitWorkflowService` for commit, push, pull, publish, and change-request creation. If panel-specific file selection is needed, pass file paths through existing Git action inputs rather than creating a parallel commit code path.

8. Refresh local status after checkpoint writes, provider command completion, source-control operations, branch/worktree switches, stash operations, remote add/remove/fetch, and repository initialization. Keep remote status polling bounded and avoid blocking the local file-change list on provider API latency.

9. Preserve multi-client behavior. If one client stages, commits, discards changes, adds/removes/fetches remotes, applies/drops stashes, merges, renames/deletes branches, or switches branches, every subscribed client for the same environment/cwd should receive the next relevant status snapshot.

## Web Implementation Plan

1. Add a right-panel surface component, for example `apps/web/src/components/source-control/SourceControlPanel.tsx`, and keep pure derivation helpers in adjacent `.logic.ts` files or in `packages/client-runtime` when they are shared.

2. Reuse these existing client primitives:

- `useVcsStatus`, `refreshVcsStatus`, and status atoms from `~/lib/vcsStatusState`.
- `useSourceControlDiscovery` from `~/lib/sourceControlDiscoveryState`.
- VCS action state from `~/lib/sourceControlActions` and `packages/client-runtime/src/vcsActionState.ts`.
- Existing menu/quick-action logic from `GitActionsControl.logic.ts`, moving shared logic to client-runtime if the panel and header need it.
- Existing diff rendering through `@pierre/diffs/react` and the app's diff-theme sync.

3. The panel layout should use restrained operational UI:

- Header: provider icon, repository/root label, branch/ref label, ahead/behind counts, refresh action, and overflow menu.
- Commit area: message input, selected/staged file summary, commit button, optional commit-and-push split action.
- File groups: collapsible changed-file groups with stable row height, status badges, additions/deletions, stage/unstage/discard/open controls, and inline diff expansion.
- Branches area: reusable branch rows with sync status, ahead/behind badges, incoming/outgoing commit expansion, branch actions, and compare entry points.
- Commits area: reusable commit rows with author, avatar, relative time, message, short SHA, ref labels, and commit actions.
- Graph area: bounded current-branch graph with local/synced/upstream highlighting and visible branch-head/tag decorations.
- Stashes area: reusable stash rows with apply/pop/rename/drop/copy/compare actions.
- Sync/change-request area: fetch/pull/push/sync/create/open change-request controls with disabled-state explanations.
- Remotes area: remote list, add remote dialog, fetch/remove actions, per-remote branch list, and create/switch local branch actions from remote refs.
- Compare area: branch/stash/working-tree compare picker and summary, defaulting to inferred base or repository default branch.
- Diagnostics footer: last status error, Git/provider discovery hints, and link to Source Control settings.

4. Wire the panel through the existing right-panel store and tabs:

- Extend `RIGHT_PANEL_KINDS` and `RightPanelSurface` with the source-control singleton surface.
- Add source control to `RightPanelTabs`'s add-surface menu, not to the chat header.
- Add `onAddSourceControl` and `sourceControlAvailable` props alongside existing browser, terminal, and diff surface controls.
- Render the source-control surface in both inline and sheet right-panel layouts in `ChatView`.
- Update right-panel migration tests so persisted source-control surfaces survive valid migrations and are dropped cleanly if disabled by host preferences.

5. Keep selection state local to the panel and keyed by `environmentId + cwd + statusVersion` so stale file selections do not accidentally survive branch switches or refreshes that remove paths.

6. Avoid adding source-control controls to primary UI chrome. The full panel should own detailed file review, graph, branch, stash, remote, compare, and staging workflows. The only main UI affordance involved should be the already-existing right-panel toggle.

7. In VS Code webviews, respect host display preferences. Add a setting similar to `t3code.ui.enableTerminal`, for example `t3code.ui.enableSourceControlPanel`, that controls whether the T3 Code source-control right-panel surface is available and visible. The setting should hide or show the same app feature; it should not cause the extension to replace native VS Code SCM, fork the React implementation, or add VS Code-only source-control behavior.

8. Add keyboard and accessibility behavior comparable to other T3 panels: focusable rows, button labels/tooltips for icon-only actions, confirmation dialogs for destructive changes, and no layout shift when counts or progress labels update.

9. Build reusable entity components first:

- `SourceControlBranchItem` for branch lists, remote branch expansions, compare pickers, and current-branch summaries.
- `SourceControlCommitItem` for graph nodes, branch incoming/outgoing lists, current branch history, compare lists, and stash metadata.
- `SourceControlRemoteItem` for repository summary, remote management, and remote branch browsing.
- `SourceControlStashItem` for stash lists, compare views, and stash action confirmations.
- `SourceControlFileChangeItem` for staged/unstaged groups, compare results, stash files, and commit file summaries.

Each item should receive normalized entity data plus a capability/action descriptor rather than directly reaching into route-specific state. This keeps visual rendering consistent while letting each view decide which actions are available.

## VS Code Extension Considerations

The VS Code extension should not try to replace VS Code's native Source Control view. Native VS Code already owns editor gutter indicators, the Source Control view, SCM repositories view, branch status, diff editors, conflict tools, and extension-provided SCM providers.

The extension should add a source-control panel display setting that behaves like the terminal display setting:

- When `t3code.ui.enableSourceControlPanel` is `true`, the VS Code webview presents the same T3 Code source-control panel that desktop/browser surfaces present for the same workspace and environment.
- When `t3code.ui.enableSourceControlPanel` is `false`, the VS Code webview hides the T3 Code source-control panel and related entry points.
- The setting is a display preference only. It must not change backend source-control capabilities, provider behavior, repository state, or the React panel's implementation.
- The extension must not override or replace anything built by T3 Code. It either exposes the shared app functionality or hides it.

T3 Code should integrate with that environment by:

- Keeping VS Code host controls hidden when they duplicate native editor surfaces.
- Opening file diffs through existing editor preferences or VS Code commands when running in a VS Code host.
- Treating the panel as a T3-specific workflow surface for agent-produced changes, selected-file commits, stacked Git actions, publishing, and PR/MR creation.
- Avoiding direct VS Code SCM API writes unless the extension later contributes its own SCM provider. For the current desktop-backed extension model, repository operations should stay desktop-server-owned.

## Decisions Captured

- Build a T3 source-control panel, not a VS Code SCM provider implementation.
- Reuse the existing VCS status/action/discovery stack as the source of truth.
- Keep the chat-header Git action control compact; move detailed review/staging/commit workflows into the panel.
- Start with Git. Keep contract names VCS/source-control-friendly so future drivers such as Jujutsu can opt in deliberately.
- Treat file staging, unstaging, discarding, and stashing as explicit operations with their own contracts and tests. Hunk/range staging can be added later, but it is not required for the first high-level management panel.
- Treat branches, commits, stashes, remotes, graph commits, and file changes as reusable entities rendered by shared item components.
- Treat remote management as a first-class source-control workflow: list remotes, add/remove remotes, fetch remotes, list per-remote branches, and create/switch local branches from remote refs.
- Treat compare as a reusable workflow for working tree, branch, and stash entities.
- Preserve server authority for repository operations across desktop, browser, VS Code, and remote clients.
- Keep VS Code extension behavior complementary to VS Code's native Source Control panel, with a host display setting that either shows the shared T3 Code source-control panel or hides it.

## Verification Plan

Focused validation should include:

- Server tests for grouped status parsing, staged/unstaged/untracked/conflict cases, path containment, file stage/unstage/discard/stash operations, and post-operation status refresh.
- Server tests for branch fetch/pull/push/publish/merge/delete/rename, force-operation confirmations at the contract layer, commit undo/revert/checkout/create-branch/create-tag, graph ranges, stash apply/pop/rename/drop, compare summaries, and remote open/copy metadata.
- Server tests for remote list/add/remove/fetch, remote branch listing, local branch creation from remote refs, invalid remote names, duplicate remotes, and post-fetch status refresh.
- Client-runtime tests for panel snapshot derivation, reusable entity normalization, action-state transitions, stale selection invalidation, compare target defaults, and status stream updates across reconnects.
- Web component tests for non-repo, clean repo, dirty repo, staged/unstaged groups, conflicts, disabled push/pull states, reusable branch/commit/remote/stash/file item rendering, graph labels, remote add/fetch/remove flows, remote branch actions, stash actions, compare actions, default-branch confirmation, commit selection, publish guidance, and operation errors.
- VS Code extension tests for the source-control panel display preference, verifying that the extension hides or shows the shared app feature without changing source-control behavior.
- Browser regression checks for dense file lists, long paths, mobile/narrow widths, VS Code webview width, dark/light themes, and inline diff rendering.
- Existing source-control action tests should remain green after moving any shared logic out of `GitActionsControl`.

Before considering the feature complete:

```sh
pnpm exec vp check
pnpm exec vp run typecheck
```

If native mobile code changes in a future pass, also run:

```sh
pnpm exec vp run lint:mobile
```

## Remaining Risks And Hardening Items

1. Status cost can grow quickly in large repositories. The first grouped status implementation should be measured against large working trees and should not block the UI on remote/provider checks.

2. Hunk staging is easy to get subtly wrong. It should use structured patch application or proven Git plumbing rather than ad hoc string slicing.

3. Multi-root and worktree scoping must be explicit. The panel should always show which cwd it is operating on and should not apply actions to an adjacent worktree by accident.

4. Destructive operations need strong confirmation and containment checks. Discarding generated or agent-edited changes is irreversible from the app's point of view unless a checkpoint can recover them.

5. VS Code users may already rely on native SCM. T3 Code should avoid competing UI noise and should focus on agent-aware workflows that native SCM does not understand.

6. Provider-specific change-request features vary across GitHub, GitLab, Bitbucket, and Azure DevOps. The panel should use provider-neutral labels where possible and provider-specific copy only when the provider is known.

7. Remote clients connected to a desktop backend can operate on local repositories. The UI should make the target machine/environment clear before commit, discard, branch, publish, or PR actions.

8. Remote management can be destructive or confusing in multi-remote repositories. Remove-remote, default-remote selection, and local branch creation from remote refs need explicit naming, confirmation where appropriate, and clear post-action status.

9. VS Code users may disable the T3 Code source-control panel because they prefer native SCM. That setting should not create a second behavior path; it should only hide the shared panel and related entry points.
