import { describe, expect, it } from "vite-plus/test";

import { buildRunVcsStackedActionInput } from "./sourceControlActions.logic";

describe("buildRunVcsStackedActionInput", () => {
  it("forwards an exact commit patch", () => {
    expect(
      buildRunVcsStackedActionInput({
        actionId: "action-1",
        action: "commit",
        commitMessage: "fix: scoped commit",
        commitPatch: "diff --git a/a.txt b/a.txt",
      }),
    ).toEqual({
      actionId: "action-1",
      action: "commit",
      commitMessage: "fix: scoped commit",
      commitPatch: "diff --git a/a.txt b/a.txt",
    });
  });

  it("continues to forward ordinary file selection", () => {
    expect(
      buildRunVcsStackedActionInput({
        actionId: "action-2",
        action: "commit",
        filePaths: ["README.md"],
      }),
    ).toEqual({
      actionId: "action-2",
      action: "commit",
      filePaths: ["README.md"],
    });
  });
});
