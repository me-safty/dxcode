import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentId, TurnId } from "@t3tools/contracts";

import {
  __readWorkspaceFilePanelStateForTests,
  __resetWorkspaceFilePanelStateForTests,
  closeWorkspaceFilePreview,
  openWorkspaceFileExplorer,
  openWorkspaceFilePreview,
  resolveWorkspaceFilePreviewTarget,
  returnWorkspaceFileExplorerToPreview,
  returnWorkspaceFilePreviewToExplorer,
  type WorkspaceFilePreviewReturnTarget,
  type WorkspaceFilePreviewTarget,
} from "./workspaceFilePreview";

const environmentId = EnvironmentId.make("env-preview-test");
const diffReturnTarget = {
  kind: "diff",
  diffTurnId: TurnId.make("turn-preview-test"),
  diffFilePath: "src/index.ts",
} satisfies WorkspaceFilePreviewReturnTarget;

function createPreviewTarget(relativePath = "src/index.ts"): WorkspaceFilePreviewTarget {
  return {
    environmentId,
    cwd: "/repo/project",
    relativePath,
    displayPath: relativePath,
  };
}

afterEach(() => {
  __resetWorkspaceFilePanelStateForTests();
});

describe("resolveWorkspaceFilePreviewTarget", () => {
  it("resolves absolute workspace paths to relative read targets", () => {
    expect(
      resolveWorkspaceFilePreviewTarget({
        environmentId,
        cwd: "/repo/project",
        targetPath: "/repo/project/src/index.ts:12:4",
      }),
    ).toEqual({
      environmentId,
      cwd: "/repo/project",
      relativePath: "src/index.ts",
      displayPath: "src/index.ts",
      line: 12,
      column: 4,
    });
  });

  it("resolves relative paths and keeps custom display labels", () => {
    expect(
      resolveWorkspaceFilePreviewTarget({
        environmentId,
        cwd: "/repo/project",
        targetPath: "./src/index.ts:3",
        displayPath: "project/src/index.ts:3",
      }),
    ).toEqual({
      environmentId,
      cwd: "/repo/project",
      relativePath: "src/index.ts",
      displayPath: "project/src/index.ts:3",
      line: 3,
    });
  });

  it("rejects absolute paths outside the workspace", () => {
    expect(
      resolveWorkspaceFilePreviewTarget({
        environmentId,
        cwd: "/repo/project",
        targetPath: "/repo/other/src/index.ts",
      }),
    ).toBeNull();
  });
});

describe("workspace file panel state", () => {
  it("opens the explorer and stores its workspace context", () => {
    openWorkspaceFileExplorer({
      environmentId,
      cwd: "/repo/project",
      projectName: "project",
    });

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "explorer",
      explorerContext: {
        environmentId,
        cwd: "/repo/project",
        projectName: "project",
      },
      explorerReturnPreview: null,
      returnTarget: null,
    });
  });

  it("opens a preview from the explorer with an explorer return target", () => {
    openWorkspaceFileExplorer({
      environmentId,
      cwd: "/repo/project",
      projectName: "project",
    });
    openWorkspaceFilePreview(createPreviewTarget(), { returnTarget: { kind: "explorer" } });

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "preview",
      explorerContext: {
        environmentId,
        cwd: "/repo/project",
        projectName: "project",
      },
      explorerReturnPreview: null,
      returnTarget: { kind: "explorer" },
      target: {
        environmentId,
        cwd: "/repo/project",
        relativePath: "src/index.ts",
      },
    });
  });

  it("closes the panel while preserving the last target and clearing return context", () => {
    const previewTarget = createPreviewTarget();
    openWorkspaceFileExplorer(
      {
        environmentId,
        cwd: "/repo/project",
      },
      { returnToPreview: { target: previewTarget, returnTarget: diffReturnTarget } },
    );
    returnWorkspaceFileExplorerToPreview();
    closeWorkspaceFilePreview();

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: false,
      view: "preview",
      explorerContext: {
        environmentId,
        cwd: "/repo/project",
      },
      explorerReturnPreview: null,
      returnTarget: null,
      target: {
        environmentId,
        cwd: "/repo/project",
        relativePath: "src/index.ts",
      },
    });
  });

  it("opens explorer as a fresh action without stale preview-return breadcrumbs", () => {
    const previewTarget = createPreviewTarget();
    openWorkspaceFileExplorer(
      {
        environmentId,
        cwd: "/repo/project",
      },
      { returnToPreview: { target: previewTarget, returnTarget: diffReturnTarget } },
    );
    openWorkspaceFileExplorer({
      environmentId,
      cwd: "/repo/project",
      projectName: "project",
    });

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "explorer",
      explorerContext: {
        environmentId,
        cwd: "/repo/project",
        projectName: "project",
      },
      explorerReturnPreview: null,
      returnTarget: null,
    });
  });

  it("opens explorer from preview with exactly one preview-return breadcrumb", () => {
    const previewTarget = createPreviewTarget();
    openWorkspaceFileExplorer(
      {
        environmentId,
        cwd: "/repo/project",
        projectName: "project",
      },
      { returnToPreview: { target: previewTarget, returnTarget: diffReturnTarget } },
    );

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "explorer",
      explorerReturnPreview: {
        target: previewTarget,
        returnTarget: diffReturnTarget,
      },
      returnTarget: null,
    });
  });

  it("returns explorer to preview once and consumes the breadcrumb", () => {
    const previewTarget = createPreviewTarget();
    openWorkspaceFileExplorer(
      {
        environmentId,
        cwd: "/repo/project",
      },
      { returnToPreview: { target: previewTarget, returnTarget: diffReturnTarget } },
    );
    returnWorkspaceFileExplorerToPreview();

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "preview",
      target: previewTarget,
      returnTarget: diffReturnTarget,
      explorerReturnPreview: null,
    });

    returnWorkspaceFileExplorerToPreview();
    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "preview",
      target: previewTarget,
      returnTarget: diffReturnTarget,
      explorerReturnPreview: null,
    });
  });

  it("returns preview to explorer without creating a reverse breadcrumb", () => {
    openWorkspaceFilePreview(createPreviewTarget(), { returnTarget: { kind: "explorer" } });
    returnWorkspaceFilePreviewToExplorer({
      environmentId,
      cwd: "/repo/project",
      projectName: "project",
    });

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "explorer",
      explorerContext: {
        environmentId,
        cwd: "/repo/project",
        projectName: "project",
      },
      explorerReturnPreview: null,
      returnTarget: null,
    });
  });

  it("opens a new explorer file and clears any previous preview breadcrumb", () => {
    const previousTarget = createPreviewTarget("README.md");
    openWorkspaceFileExplorer(
      {
        environmentId,
        cwd: "/repo/project",
      },
      { returnToPreview: { target: previousTarget, returnTarget: diffReturnTarget } },
    );
    openWorkspaceFilePreview(createPreviewTarget("src/next.ts"), {
      returnTarget: { kind: "explorer" },
    });

    expect(__readWorkspaceFilePanelStateForTests()).toMatchObject({
      open: true,
      view: "preview",
      explorerReturnPreview: null,
      returnTarget: { kind: "explorer" },
      target: {
        environmentId,
        cwd: "/repo/project",
        relativePath: "src/next.ts",
      },
    });
  });
});
