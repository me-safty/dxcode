import { describe, expect, it } from "vitest";

import {
  buildWorkspaceChangeDecorations,
  parentPathsOf,
  workspaceStatusBadge,
  type WorkspaceChangedFile,
} from "./workspace-file-status";

function changedFile(path: string, status: WorkspaceChangedFile["status"]): WorkspaceChangedFile {
  return {
    path,
    status,
    insertions: 0,
    deletions: 0,
  };
}

describe("parentPathsOf", () => {
  it("returns every nested parent path in order", () => {
    expect(parentPathsOf("src/components/App.tsx")).toEqual(["src", "src/components"]);
  });

  it("returns no parents for root files", () => {
    expect(parentPathsOf("README.md")).toEqual([]);
  });
});

describe("buildWorkspaceChangeDecorations", () => {
  it("creates file decorations for changed files", () => {
    const decorations = buildWorkspaceChangeDecorations([changedFile("README.md", "untracked")]);

    expect(decorations.get("README.md")).toEqual({
      source: "file",
      status: "untracked",
      descendantCount: 1,
    });
  });

  it("decorates parent folders for changed descendants", () => {
    const decorations = buildWorkspaceChangeDecorations([
      changedFile("src/components/App.tsx", "modified"),
    ]);

    expect(decorations.get("src")).toEqual({
      source: "directory",
      status: "modified",
      descendantCount: 1,
    });
    expect(decorations.get("src/components")).toEqual({
      source: "directory",
      status: "modified",
      descendantCount: 1,
    });
  });

  it("counts multiple changed descendants in a directory", () => {
    const decorations = buildWorkspaceChangeDecorations([
      changedFile("src/App.tsx", "modified"),
      changedFile("src/main.tsx", "untracked"),
    ]);

    expect(decorations.get("src")).toEqual({
      source: "directory",
      status: "modified",
      descendantCount: 2,
    });
  });

  it("uses deterministic aggregate status priority for folders", () => {
    expect(
      buildWorkspaceChangeDecorations([
        changedFile("src/a.ts", "modified"),
        changedFile("src/b.ts", "conflicted"),
      ]).get("src")?.status,
    ).toBe("conflicted");

    expect(
      buildWorkspaceChangeDecorations([
        changedFile("src/a.ts", "modified"),
        changedFile("src/b.ts", "deleted"),
      ]).get("src")?.status,
    ).toBe("deleted");

    expect(
      buildWorkspaceChangeDecorations([
        changedFile("src/a.ts", "untracked"),
        changedFile("src/b.ts", "modified"),
      ]).get("src")?.status,
    ).toBe("modified");

    expect(
      buildWorkspaceChangeDecorations([
        changedFile("src/a.ts", "added"),
        changedFile("src/b.ts", "renamed"),
      ]).get("src")?.status,
    ).toBe("renamed");
  });

  it("keeps exact file decorations authoritative over directory aggregation", () => {
    const decorations = buildWorkspaceChangeDecorations([
      changedFile("src", "added"),
      changedFile("src/App.tsx", "modified"),
    ]);

    expect(decorations.get("src")).toEqual({
      source: "file",
      status: "added",
      descendantCount: 1,
    });
  });
});

describe("workspaceStatusBadge", () => {
  it("maps git statuses to row badge metadata", () => {
    expect(workspaceStatusBadge("modified")).toEqual({
      letter: "M",
      label: "modified",
      className: "text-warning-foreground",
    });
    expect(workspaceStatusBadge("added")).toEqual({
      letter: "A",
      label: "added",
      className: "text-success",
    });
    expect(workspaceStatusBadge("untracked")).toEqual({
      letter: "U",
      label: "untracked",
      className: "text-success",
    });
    expect(workspaceStatusBadge("deleted")).toEqual({
      letter: "D",
      label: "deleted",
      className: "text-destructive",
    });
    expect(workspaceStatusBadge("renamed")).toEqual({
      letter: "R",
      label: "renamed",
      className: "text-warning-foreground",
    });
    expect(workspaceStatusBadge("copied")).toEqual({
      letter: "C",
      label: "copied",
      className: "text-warning-foreground",
    });
    expect(workspaceStatusBadge("conflicted")).toEqual({
      letter: "C",
      label: "conflicted",
      className: "text-destructive",
    });
  });
});
