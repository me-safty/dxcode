import { describe, expect, it } from "vitest";

import {
  getGitHubActivityItemsForWorkItem,
  groupGitHubActivityByWorkItem,
  type GitHubWorkActivityItem,
} from "./t3work-githubActivity";

describe("github activity", () => {
  it("matches work item activity case-insensitively", () => {
    const items: ReadonlyArray<GitHubWorkActivityItem> = [
      {
        id: "gh-1",
        repository: "repo",
        reason: "review_requested",
        workItemKey: "IES-9242",
      },
    ];

    const grouped = groupGitHubActivityByWorkItem(items);

    expect(getGitHubActivityItemsForWorkItem(grouped, "IES-9242")).toHaveLength(1);
    expect(getGitHubActivityItemsForWorkItem(grouped, "ies-9242")).toHaveLength(1);
  });
});
