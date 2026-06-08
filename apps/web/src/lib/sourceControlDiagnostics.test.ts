import { afterEach, describe, expect, it, vi } from "vitest";

const { downloadPlanAsTextFileSpy } = vi.hoisted(() => ({
  downloadPlanAsTextFileSpy: vi.fn(),
}));

vi.mock("../proposedPlan", () => ({
  downloadPlanAsTextFile: downloadPlanAsTextFileSpy,
}));

import {
  buildSourceControlDiagnosticsReport,
  clearSourceControlDiagnosticsForTests,
  exportSourceControlDiagnostics,
  recordSourceControlDiagnosticEvent,
  recordSourceControlDisabledSnapshot,
  sourceControlActionDisabledReasons,
  type SourceControlActionDisabledSnapshot,
} from "./sourceControlDiagnostics";

function createSnapshot(
  overrides?: Partial<SourceControlActionDisabledSnapshot>,
): SourceControlActionDisabledSnapshot {
  return {
    environmentId: "environment-a",
    cwd: "/repo/project",
    actionDisabled: false,
    actionDisabledReasons: [],
    isGitActionRunning: false,
    isGitActionRunningRaw: false,
    isFinalizingAction: false,
    isPushing: false,
    isStageOperationRunning: false,
    stageFilesPending: false,
    unstageFilesPending: false,
    revertUnstagedFilesPending: false,
    pendingStageCount: 0,
    pendingUnstageCount: 0,
    pendingRevertCount: 0,
    stagedFileCount: 1,
    unstagedFileCount: 2,
    hasChanges: true,
    gitStatusAvailable: true,
    gitStatusError: null,
    ...overrides,
  };
}

afterEach(() => {
  clearSourceControlDiagnosticsForTests();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("sourceControlActionDisabledReasons", () => {
  it("returns exact reason strings for active disabled inputs", () => {
    expect(
      sourceControlActionDisabledReasons({
        isGitActionRunningRaw: true,
        isFinalizingAction: true,
        isPushing: true,
        stageFilesPending: true,
        unstageFilesPending: true,
        revertUnstagedFilesPending: true,
      }),
    ).toEqual([
      "git-action-running",
      "finalizing-action",
      "pushing",
      "stage-files-pending",
      "unstage-files-pending",
      "revert-unstaged-files-pending",
    ]);
  });
});

describe("source-control disabled snapshot diagnostics", () => {
  it("records meaningful disabled-state transitions and dedupes identical snapshots", () => {
    const enabled = createSnapshot();
    const stagePending = createSnapshot({
      actionDisabled: true,
      actionDisabledReasons: ["stage-files-pending"],
      isStageOperationRunning: true,
      stageFilesPending: true,
    });
    const revertPending = createSnapshot({
      actionDisabled: true,
      actionDisabledReasons: ["revert-unstaged-files-pending"],
      isStageOperationRunning: true,
      revertUnstagedFilesPending: true,
    });

    recordSourceControlDisabledSnapshot(enabled);
    recordSourceControlDisabledSnapshot(enabled);
    recordSourceControlDisabledSnapshot(stagePending);
    recordSourceControlDisabledSnapshot(stagePending);
    recordSourceControlDisabledSnapshot(revertPending);
    recordSourceControlDisabledSnapshot(enabled);

    const report = buildSourceControlDiagnosticsReport();

    expect(report).toContain("- disabled-state: 4");
    expect(report).toContain("stage-files-pending");
    expect(report).toContain("revert-unstaged-files-pending");
  });

  it("caps the event buffer and keeps the newest entries", () => {
    for (let index = 0; index < 505; index += 1) {
      recordSourceControlDiagnosticEvent({
        kind: "row-action-settled",
        action: "revert",
        filePaths: [`src/file-${index.toString()}.ts`],
      });
    }

    const report = buildSourceControlDiagnosticsReport();

    expect(report).toContain("- Total events retained: 500");
    expect(report).not.toContain("src/file-0.ts");
    expect(report).toContain("src/file-504.ts");
  });

  it("builds a report with current snapshot, timeline, and raw JSON", () => {
    const snapshot = createSnapshot({
      actionDisabled: true,
      actionDisabledReasons: ["revert-unstaged-files-pending"],
      revertUnstagedFilesPending: true,
    });
    recordSourceControlDisabledSnapshot(snapshot);

    const report = buildSourceControlDiagnosticsReport({ currentSnapshot: snapshot });

    expect(report).toContain("# Source-control diagnostics");
    expect(report).toContain("## Current disabled snapshot");
    expect(report).toContain("- cwd: /repo/project");
    expect(report).toContain("revert-unstaged-files-pending");
    expect(report).toContain("## Timeline");
    expect(report).toContain("## Raw JSON snapshot");
    expect(report).toContain('"currentSnapshot"');
  });

  it("includes pointer hit-test events in the timeline and raw JSON", () => {
    const snapshot = createSnapshot();
    recordSourceControlDiagnosticEvent({
      kind: "pointer-hit-test",
      pointerType: "touch",
      clientX: 321,
      clientY: 654,
      elementTag: "button",
      elementAriaLabel: "Revert docs/file-000.ts",
      buttonAriaLabel: "Revert docs/file-000.ts",
      buttonDisabled: false,
      sourceControlAction: "revert",
      sourceControlPath: "docs/file-000.ts",
      sourceControlRowKey: "unstaged:file:docs/file-000.ts",
      snapshot,
    });

    const report = buildSourceControlDiagnosticsReport({ currentSnapshot: snapshot });

    expect(report).toContain("- pointer-hit-test: 1");
    expect(report).toContain("pointer-hit-test");
    expect(report).toContain("buttonAriaLabel=Revert docs/file-000.ts");
    expect(report).toContain("buttonDisabled=false");
    expect(report).toContain("revert");
    expect(report).toContain("docs/file-000.ts");
    expect(report).toContain("rowKey=unstaged:file:docs/file-000.ts");
    expect(report).toContain('"buttonAriaLabel": "Revert docs/file-000.ts"');
    expect(report).toContain('"buttonDisabled": false');
    expect(report).toContain('"sourceControlAction": "revert"');
    expect(report).toContain('"sourceControlPath": "docs/file-000.ts"');
    expect(report).toContain('"sourceControlRowKey": "unstaged:file:docs/file-000.ts"');
  });
});

describe("exportSourceControlDiagnostics", () => {
  it("uses native file sharing when available", async () => {
    class MockFile {
      constructor(
        readonly parts: readonly BlobPart[],
        readonly name: string,
        readonly options?: FilePropertyBag,
      ) {}
    }
    const share = vi.fn(() => Promise.resolve());
    const canShare = vi.fn(() => true);
    vi.stubGlobal("File", MockFile);
    vi.stubGlobal("navigator", {
      userAgent: "test-agent",
      canShare,
      share,
    });

    await expect(exportSourceControlDiagnostics()).resolves.toBe("shared");

    expect(canShare).toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Source-control diagnostics" }),
    );
    expect(downloadPlanAsTextFileSpy).not.toHaveBeenCalled();
  });

  it("falls back to file download when sharing is unavailable", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "test-agent",
      canShare: vi.fn(() => false),
    });

    await expect(exportSourceControlDiagnostics()).resolves.toBe("downloaded");

    expect(downloadPlanAsTextFileSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^source-control-diagnostics-.*\.md$/),
      expect.stringContaining("# Source-control diagnostics"),
    );
  });

  it("falls back to clipboard when download fails", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    downloadPlanAsTextFileSpy.mockImplementationOnce(() => {
      throw new Error("download unavailable");
    });
    vi.stubGlobal("navigator", {
      userAgent: "test-agent",
      clipboard: { writeText },
    });

    await expect(exportSourceControlDiagnostics()).resolves.toBe("copied");

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("# Source-control diagnostics"));
  });
});
