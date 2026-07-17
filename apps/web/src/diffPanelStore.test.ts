import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("diffPanelStore", () => {
  beforeEach(() => useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} }));

  it("defaults each thread to all working tree changes", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "working-tree", file: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "working-tree", file: null });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });

  it("selects staged and unstaged versions of the same path independently", () => {
    useDiffPanelStore.getState().selectWorkingTreeFile(THREAD_REF, "unstaged", "src/app.ts");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "working-tree",
      file: { area: "unstaged", path: "src/app.ts" },
    });

    useDiffPanelStore.getState().selectWorkingTreeFile(THREAD_REF, "staged", "src/app.ts");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "working-tree",
      file: { area: "staged", path: "src/app.ts" },
    });
  });

  it("transfers the selected unstaged file after staging", () => {
    useDiffPanelStore.getState().selectWorkingTreeFile(THREAD_REF, "unstaged", "src/app.ts");
    useDiffPanelStore.getState().transferWorkingTreeFileToStaged(THREAD_REF, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "working-tree",
      file: { area: "staged", path: "src/app.ts" },
    });
  });

  it("transfers the selected staged file after unstaging", () => {
    useDiffPanelStore.getState().selectWorkingTreeFile(THREAD_REF, "staged", "src/app.ts");
    useDiffPanelStore.getState().transferWorkingTreeFileToUnstaged(THREAD_REF, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "working-tree",
      file: { area: "unstaged", path: "src/app.ts" },
    });
  });

  it("clears a working tree file selection when its entry disappears", () => {
    useDiffPanelStore.getState().selectWorkingTreeFile(THREAD_REF, "unstaged", "src/app.ts");
    useDiffPanelStore.getState().reconcileWorkingTreeSelection(THREAD_REF, [], []);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "working-tree", file: null });
  });

  it("moves a selection only after a refreshed manifest moves the file", () => {
    useDiffPanelStore.getState().selectWorkingTreeFile(THREAD_REF, "unstaged", "src/app.ts");

    useDiffPanelStore.getState().reconcileWorkingTreeSelection(THREAD_REF, [], ["src/app.ts"]);
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "working-tree",
      file: { area: "unstaged", path: "src/app.ts" },
    });

    useDiffPanelStore.getState().reconcileWorkingTreeSelection(THREAD_REF, ["src/app.ts"], []);
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "working-tree",
      file: { area: "staged", path: "src/app.ts" },
    });
  });
});
