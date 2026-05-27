import { describe, expect, it } from "vitest";

import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";

import { buildGitHubActivityBadgeTitle } from "./t3work-GitHubActivityTitleBadge";

describe("GitHubActivityTitleBadge", () => {
  it("describes linked pull requests explicitly instead of a generic badge", () => {
    const title = buildGitHubActivityBadgeTitle({
      item: {
        id: "gh-pr",
        repository: "acme/alpha",
        reason: "pull request",
        subjectType: "PullRequest",
        subjectTitle: "IES-9242 Add linked PR visibility",
        subjectState: "merged",
      } satisfies GitHubWorkActivityItem,
      count: 2,
    });

    expect(title).toBe("PR merged: IES-9242 Add linked PR visibility (2 GitHub items)");
  });

  it("describes workflow noise without collapsing to an unlabeled icon", () => {
    const title = buildGitHubActivityBadgeTitle({
      item: {
        id: "gh-build",
        repository: "acme/alpha",
        reason: "ci_activity",
        subjectTitle: "Build failed on main",
      } satisfies GitHubWorkActivityItem,
      count: 1,
    });

    expect(title).toBe("Workflow activity: Build failed on main");
  });
});
