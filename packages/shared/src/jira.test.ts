import { describe, expect, it } from "vite-plus/test";

import {
  applyProjectKeyPrefix,
  buildJiraCreateTicketUrl,
  buildJiraTicketUrl,
  buildRenamedJiraBranchName,
  buildSemanticWorktreeBranchName,
  DEFAULT_WORKTREE_BRANCH_PREFIX,
  deriveWorktreeBranchSuffix,
  isMainOrMasterBranchName,
  isTemporaryWorktreeBranchForAnyPrefix,
  normalizeJiraDomain,
  normalizeJiraProjectKey,
  normalizeWorktreeBranchPrefix,
  validateJiraKeyInput,
} from "./jira.ts";

describe("isTemporaryWorktreeBranchForAnyPrefix", () => {
  it("matches default-prefix temp branches", () => {
    expect(isTemporaryWorktreeBranchForAnyPrefix("empcode/deadbeef")).toBe(true);
    expect(isTemporaryWorktreeBranchForAnyPrefix(" empcode/DEADBEEF ")).toBe(true);
  });

  it("matches jira-prefixed temp branches", () => {
    expect(isTemporaryWorktreeBranchForAnyPrefix("JIRA-123/deadbeef")).toBe(true);
    expect(isTemporaryWorktreeBranchForAnyPrefix("ABC-1/abcd1234")).toBe(true);
  });

  it("rejects semantic branches even when the suffix is hex-shaped", () => {
    expect(isTemporaryWorktreeBranchForAnyPrefix("JIRA-123/feature-name")).toBe(false);
    // 8 hex chars but the prefix is neither default nor a jira key.
    expect(isTemporaryWorktreeBranchForAnyPrefix("feature/abcdef12")).toBe(false);
  });

  it("rejects malformed branches", () => {
    expect(isTemporaryWorktreeBranchForAnyPrefix("main")).toBe(false);
    expect(isTemporaryWorktreeBranchForAnyPrefix("empcode/")).toBe(false);
    expect(isTemporaryWorktreeBranchForAnyPrefix("/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranchForAnyPrefix("empcode/deadbeefxx")).toBe(false);
  });
});

describe("buildRenamedJiraBranchName", () => {
  it("uses the sanitized title when the current branch is a default-prefix temp", () => {
    expect(
      buildRenamedJiraBranchName({
        currentBranch: "empcode/abcd1234",
        newJiraKey: "JIRA-123",
        fallbackTitle: "Fix login flow",
      }),
    ).toBe("JIRA-123/fix-login-flow");
  });

  it("uses the sanitized title when the current branch is a jira-prefix temp", () => {
    expect(
      buildRenamedJiraBranchName({
        currentBranch: "OLD-9/abcd1234",
        newJiraKey: "NEW-1",
        fallbackTitle: "Patch payment bug",
      }),
    ).toBe("NEW-1/patch-payment-bug");
  });

  it("preserves the existing suffix when the current branch is semantic", () => {
    expect(
      buildRenamedJiraBranchName({
        currentBranch: "feature/foo-bar",
        newJiraKey: "JIRA-7",
        fallbackTitle: "Title that should not be used",
      }),
    ).toBe("JIRA-7/foo-bar");
  });

  it("falls back to the title when the current branch has no suffix", () => {
    expect(
      buildRenamedJiraBranchName({
        currentBranch: "main",
        newJiraKey: "JIRA-9",
        fallbackTitle: "Hotfix release",
      }),
    ).toBe("JIRA-9/hotfix-release");
  });

  it("normalizes lowercase Jira keys to uppercase", () => {
    expect(
      buildRenamedJiraBranchName({
        currentBranch: "feature/refactor-auth",
        newJiraKey: "abc-123",
        fallbackTitle: "anything",
      }),
    ).toBe("ABC-123/refactor-auth");
  });
});

describe("worktree branch helpers", () => {
  it("uses empcode as the default worktree branch prefix", () => {
    expect(DEFAULT_WORKTREE_BRANCH_PREFIX).toBe("empcode");
    expect(normalizeWorktreeBranchPrefix(" EmpCode ")).toBe("empcode");
  });

  it("preserves jira-style prefixes in uppercase", () => {
    expect(normalizeWorktreeBranchPrefix("abc-123")).toBe("ABC-123");
  });

  it("derives a suffix from the namespaced worktree branch", () => {
    expect(deriveWorktreeBranchSuffix("ABC-123/fix-login-flow")).toBe("fix-login-flow");
    expect(deriveWorktreeBranchSuffix("main")).toBeNull();
  });

  it("builds semantic jira worktree branches", () => {
    expect(buildSemanticWorktreeBranchName("abc-123", "Fix login flow")).toBe(
      "ABC-123/fix-login-flow",
    );
  });

  it("identifies main and master as protected branch names", () => {
    expect(isMainOrMasterBranchName("main")).toBe(true);
    expect(isMainOrMasterBranchName("master")).toBe(true);
    expect(isMainOrMasterBranchName("refs/heads/main")).toBe(true);
    expect(isMainOrMasterBranchName("feature/main")).toBe(false);
  });

  it("validates jira keys against an optional configured project key", () => {
    expect(validateJiraKeyInput("abc-123")).toEqual({ normalized: "ABC-123", error: null });
    expect(validateJiraKeyInput("some-123", "SOME")).toEqual({
      normalized: "SOME-123",
      error: null,
    });
    expect(validateJiraKeyInput("other-123", "SOME")).toEqual({
      normalized: null,
      error: "Use a Jira key like SOME-123.",
    });
  });

  it("normalizes jira domains and project keys", () => {
    expect(normalizeJiraDomain("https://Example.atlassian.net/")).toBe("example");
    expect(normalizeJiraProjectKey(" some ")).toBe("SOME");
    expect(normalizeJiraProjectKey("1bad")).toBeNull();
  });

  it("builds jira issue and create-ticket urls", () => {
    expect(buildJiraTicketUrl("example", "SOME-123")).toBe(
      "https://example.atlassian.net/browse/SOME-123",
    );
    expect(buildJiraCreateTicketUrl("example")).toBe(
      "https://example.atlassian.net/secure/CreateIssue.jspa",
    );
  });
});

describe("applyProjectKeyPrefix", () => {
  it("prefixes a bare number with the configured project key", () => {
    expect(applyProjectKeyPrefix("1234", "PLAT")).toBe("PLAT-1234");
    expect(applyProjectKeyPrefix("12", "PLAT")).toBe("PLAT-12");
  });

  it("accepts a full key as-is and normalizes case (no double-prefix)", () => {
    expect(applyProjectKeyPrefix("PLAT-1234", "PLAT")).toBe("PLAT-1234");
    expect(applyProjectKeyPrefix("plat-1234", "PLAT")).toBe("PLAT-1234");
  });

  it("does not prefix when the project key alone is typed", () => {
    expect(applyProjectKeyPrefix("PLAT", "PLAT")).toBe("PLAT");
  });

  it("leaves partial alpha input untouched mid-typing", () => {
    expect(applyProjectKeyPrefix("pl", "PLAT")).toBe("pl");
    expect(applyProjectKeyPrefix("ABC-9", "PLAT")).toBe("ABC-9");
  });

  it("returns empty input unchanged", () => {
    expect(applyProjectKeyPrefix("", "PLAT")).toBe("");
    expect(applyProjectKeyPrefix("   ", "PLAT")).toBe("");
  });

  it("does not prefix when no project key is configured", () => {
    expect(applyProjectKeyPrefix("1234")).toBe("1234");
    expect(applyProjectKeyPrefix("1234", null)).toBe("1234");
  });

  it("feeds into validateJiraKeyInput so bare numbers validate", () => {
    expect(validateJiraKeyInput("1234", "PLAT")).toEqual({
      normalized: "PLAT-1234",
      error: null,
    });
  });
});
