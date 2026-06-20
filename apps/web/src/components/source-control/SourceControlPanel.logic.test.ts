import { describe, expect, it } from "@effect/vitest";
import type {
  VcsPanelBranchDetails,
  VcsPanelCommitSummary,
  VcsPanelSnapshotResult,
  VcsRef,
} from "@t3tools/contracts";

import {
  branchAttention,
  branchHasUpstream,
  branchSyncState,
  formatRelativeDate,
  mergeBranchCommitPage,
  mergeChangeGroups,
} from "./SourceControlPanel.logic";

const baseSnapshot: VcsPanelSnapshotResult = {
  status: {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "split/vscode-extension-work",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 7,
    behindCount: 47,
    aheadOfDefaultCount: 0,
    pr: null,
  },
  changeGroups: [],
  localBranches: [],
  branchDetails: [],
  remotes: [
    {
      name: "origin",
      fetchUrl: "git@example.test:fork/repo.git",
      pushUrl: "git@example.test:fork/repo.git",
      provider: null,
      branches: [],
    },
    {
      name: "upstream",
      fetchUrl: "git@example.test:upstream/repo.git",
      pushUrl: "git@example.test:upstream/repo.git",
      provider: null,
      branches: [{ name: "main", fullRefName: "upstream/main", isDefaultRemoteHead: true }],
    },
  ],
  actionableForkBranches: [],
  stashes: [],
  recentCommits: [],
  defaultCompareRef: "upstream/main",
};

function branch(input: Partial<VcsRef>): VcsRef {
  return {
    name: "split/vscode-extension-work",
    current: false,
    isDefault: false,
    worktreePath: null,
    ...input,
  };
}

function commit(sha: string): VcsPanelCommitSummary {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: `Commit ${sha.slice(0, 7)}`,
    authorName: null,
    authorEmail: null,
    authorAvatarUrl: null,
    authoredAt: null,
    headRefs: [],
    tags: [],
    files: [],
  };
}

function branchDetails(
  input: Partial<VcsPanelBranchDetails> & Pick<VcsPanelBranchDetails, "name" | "fullRefName">,
): VcsPanelBranchDetails {
  return {
    isRemote: false,
    remoteName: null,
    current: false,
    isDefault: false,
    worktreePath: null,
    upstreamRef: null,
    baseRef: null,
    unsyncedCommitShas: [],
    aheadCommits: [],
    aheadCommitsRemaining: 0,
    behindCommits: [],
    behindCommitsRemaining: 0,
    compareCommits: [],
    compareCommitsRemaining: 0,
    commits: [],
    commitsRemaining: 0,
    compareFiles: [],
    ...input,
  };
}

describe("SourceControlPanel branch sync logic", () => {
  it("publishes a local branch whose configured upstream is only its comparison base", () => {
    const localBranch = branch({
      current: true,
      upstreamName: "upstream/main",
      aheadCount: 7,
      behindCount: 47,
    });

    expect(branchHasUpstream(localBranch, baseSnapshot)).toBe(false);
    expect(branchSyncState(localBranch, baseSnapshot)).toBe("publish");
    expect(branchAttention(localBranch, baseSnapshot)).toBe("unpushed");
  });

  it("treats a same-name remote tracking branch as the sync upstream", () => {
    const localBranch = branch({
      name: "split/subagent-threading-work",
      upstreamName: "origin/split/subagent-threading-work",
      aheadCount: 0,
      behindCount: 3,
    });

    expect(branchHasUpstream(localBranch, baseSnapshot)).toBe(true);
    expect(branchSyncState(localBranch, baseSnapshot)).toBe("pull");
    expect(branchAttention(localBranch, baseSnapshot)).toBe("behind");
  });
});

describe("SourceControlPanel branch detail paging", () => {
  it("merges actionable fork pages into their fork-specific details key", () => {
    const branchName = "split/version-control-panel-work";
    const forkDetailsKey = `fork-details:${branchName}:upstream/main`;
    const forkDetails = branchDetails({
      name: branchName,
      fullRefName: branchName,
      baseRef: "upstream/main",
      behindCommits: [commit("1111111111111111111111111111111111111111")],
      behindCommitsRemaining: 1,
    });
    const branchOwnedDetails = branchDetails({
      name: branchName,
      fullRefName: branchName,
      baseRef: "origin/split/version-control-panel-work",
      behindCommits: [commit("2222222222222222222222222222222222222222")],
      behindCommitsRemaining: 4,
    });
    const current = new Map<string, VcsPanelBranchDetails>([
      [forkDetailsKey, forkDetails],
      [branchName, branchOwnedDetails],
    ]);

    const next = mergeBranchCommitPage(current, {
      detailsKey: forkDetailsKey,
      details: forkDetails,
      kind: "behind",
      page: {
        commits: [commit("3333333333333333333333333333333333333333")],
        remaining: 0,
      },
    });

    expect(next.get(forkDetailsKey)?.behindCommits.map((item) => item.sha)).toEqual([
      "1111111111111111111111111111111111111111",
      "3333333333333333333333333333333333333333",
    ]);
    expect(next.get(forkDetailsKey)?.behindCommitsRemaining).toBe(0);
    expect(next.get(branchName)?.behindCommits.map((item) => item.sha)).toEqual([
      "2222222222222222222222222222222222222222",
    ]);
    expect(next.get(branchName)?.behindCommitsRemaining).toBe(4);
  });
});

describe("SourceControlPanel working-tree presentation logic", () => {
  it("sums staged and unstaged stats for the same path", () => {
    expect(
      mergeChangeGroups([
        {
          kind: "staged",
          files: [
            {
              path: "src/file.ts",
              originalPath: null,
              status: "modified",
              insertions: 2,
              deletions: 1,
            },
          ],
        },
        {
          kind: "unstaged",
          files: [
            {
              path: "src/file.ts",
              originalPath: null,
              status: "modified",
              insertions: 3,
              deletions: 4,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        path: "src/file.ts",
        originalPath: null,
        status: "modified",
        insertions: 5,
        deletions: 5,
        hasStagedChanges: true,
        hasUnstagedChanges: true,
        hasConflicts: false,
      },
    ]);
  });

  it("preserves status precedence and conflict flags when merging paths", () => {
    expect(
      mergeChangeGroups([
        {
          kind: "staged",
          files: [
            {
              path: "src/cafe.ts",
              originalPath: null,
              status: "modified",
              insertions: 1,
              deletions: 0,
            },
          ],
        },
        {
          kind: "conflicts",
          files: [
            {
              path: "src/cafe.ts",
              originalPath: null,
              status: "conflicted",
              insertions: 0,
              deletions: 2,
            },
            {
              path: "src/áudio.ts",
              originalPath: null,
              status: "added",
              insertions: 3,
              deletions: 0,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        path: "src/áudio.ts",
        originalPath: null,
        status: "added",
        insertions: 3,
        deletions: 0,
        hasStagedChanges: false,
        hasUnstagedChanges: false,
        hasConflicts: true,
      },
      {
        path: "src/cafe.ts",
        originalPath: null,
        status: "conflicted",
        insertions: 1,
        deletions: 2,
        hasStagedChanges: true,
        hasUnstagedChanges: false,
        hasConflicts: true,
      },
    ]);
  });

  it("formats future timestamps as just now", () => {
    const now = Date.parse("2026-06-20T12:00:00.000Z");
    const then = new Date(now + 5 * 60 * 1000).toISOString();

    expect(formatRelativeDate(then, now)).toBe("just now");
  });

  it("formats late-month dates before the one-year threshold as months", () => {
    const now = Date.parse("2026-06-20T12:00:00.000Z");
    const then = new Date(now - 360 * 24 * 60 * 60 * 1000).toISOString();

    expect(formatRelativeDate(then, now)).toBe("11 months ago");
  });
});
