import { describe, expect, it } from "vite-plus/test";

import { resolveJiraKeySavePlan } from "./savePlan.ts";

describe("resolveJiraKeySavePlan", () => {
  it("saves without renaming when there is no branch", () => {
    expect(
      resolveJiraKeySavePlan({ currentBranch: null, normalizedJiraKey: "PLAT-1", title: "x" }),
    ).toEqual({ kind: "save" });
  });

  it("saves without renaming when the branch is already prefixed with the key", () => {
    expect(
      resolveJiraKeySavePlan({
        currentBranch: "PLAT-1/foo",
        normalizedJiraKey: "PLAT-1",
        title: "x",
      }),
    ).toEqual({ kind: "save" });
  });

  it("auto-renames a temporary placeholder branch", () => {
    expect(
      resolveJiraKeySavePlan({
        currentBranch: "empcode/abcd1234",
        normalizedJiraKey: "JIRA-9",
        title: "Fix login flow",
      }),
    ).toEqual({ kind: "autoRename" });
  });

  it("requests confirmation for a meaningful branch, preserving the suffix", () => {
    expect(
      resolveJiraKeySavePlan({
        currentBranch: "feature/foo",
        normalizedJiraKey: "JIRA-12",
        title: "ignored",
      }),
    ).toEqual({ kind: "confirm", targetBranch: "JIRA-12/foo" });
  });
});
