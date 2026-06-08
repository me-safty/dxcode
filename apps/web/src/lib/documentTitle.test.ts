import { describe, expect, it } from "vite-plus/test";

import { APP_DISPLAY_NAME } from "../branding";
import {
  buildThreadLocationSegment,
  buildThreadTitleSegment,
  deriveProjectTitleName,
  deriveWorktreeTitleLabel,
  formatDocumentTitle,
} from "./documentTitle";

describe("formatDocumentTitle", () => {
  it("appends the app name to a page segment", () => {
    expect(formatDocumentTitle("repo/feature")).toBe(`repo/feature · ${APP_DISPLAY_NAME}`);
  });

  it("returns the bare app name for the home page", () => {
    expect(formatDocumentTitle()).toBe(APP_DISPLAY_NAME);
    expect(formatDocumentTitle("   ")).toBe(APP_DISPLAY_NAME);
  });
});

describe("deriveProjectTitleName", () => {
  it("prefers the short repository name over the owner-qualified display name", () => {
    expect(
      deriveProjectTitleName({
        name: "fallback",
        repositoryIdentity: {
          canonicalKey: "k",
          locator: "l",
          displayName: "affil-ai/nextcard",
          name: "nextcard",
        },
      } as never),
    ).toBe("nextcard");
  });

  it("falls back to the project name when no repository name is present", () => {
    expect(deriveProjectTitleName({ name: "fallback" } as never)).toBe("fallback");
  });

  it("returns null when there is no project", () => {
    expect(deriveProjectTitleName(null)).toBeNull();
  });
});

describe("deriveWorktreeTitleLabel", () => {
  it("returns null for a local checkout", () => {
    expect(deriveWorktreeTitleLabel(null, "main")).toBeNull();
  });

  it("prefers the branch name", () => {
    expect(deriveWorktreeTitleLabel("/repo/.worktrees/abc", "feature/x")).toBe("feature/x");
  });

  it("falls back to the worktree folder basename", () => {
    expect(deriveWorktreeTitleLabel("/repo/.worktrees/abc/", null)).toBe("abc");
  });
});

describe("buildThreadLocationSegment", () => {
  it("joins repo and worktree", () => {
    expect(buildThreadLocationSegment({ repoName: "repo", worktreeLabel: "feature" })).toBe(
      "repo/feature",
    );
  });

  it("collapses to repo name on the local checkout", () => {
    expect(buildThreadLocationSegment({ repoName: "repo", worktreeLabel: null })).toBe("repo");
  });

  it("falls back to the worktree label when the repo is unknown", () => {
    expect(buildThreadLocationSegment({ repoName: null, worktreeLabel: "feature" })).toBe(
      "feature",
    );
    expect(buildThreadLocationSegment({ repoName: null, worktreeLabel: null })).toBeNull();
  });
});

describe("buildThreadTitleSegment", () => {
  it("appends the thread title to the location with a middot", () => {
    expect(
      buildThreadTitleSegment({
        repoName: "nextcard",
        worktreeLabel: "feature/random-feature",
        threadTitle: "Add image drag and paste",
      }),
    ).toBe("nextcard/feature/random-feature · Add image drag and paste");
  });

  it("uses just the location when the thread has no title", () => {
    expect(
      buildThreadTitleSegment({ repoName: "repo", worktreeLabel: "feat", threadTitle: null }),
    ).toBe("repo/feat");
  });

  it("uses just the thread title when there is no location", () => {
    expect(
      buildThreadTitleSegment({ repoName: null, worktreeLabel: null, threadTitle: "Untitled" }),
    ).toBe("Untitled");
  });
});
