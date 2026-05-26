import { describe, expect, it } from "vitest";

import { buildWorkspaceFileDiffMarkers } from "./workspace-file-diff-markers";

function gitDiff(path: string, hunk: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    hunk,
  ].join("\n");
}

describe("buildWorkspaceFileDiffMarkers", () => {
  it("maps modified hunks to marked current lines", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: gitDiff(
        "src/app.ts",
        ["@@ -1,3 +1,3 @@", " one", "-two", "+two changed", " three"].join("\n"),
      ),
      lineCount: 3,
      relativePath: "src/app.ts",
    });

    expect(result.markers).toEqual([
      expect.objectContaining({
        kind: "modified",
        lineNumber: 2,
      }),
    ]);
    expect(result.hunksById.get(result.markers[0]!.hunkId)?.anchorLine).toBe(2);
  });

  it("maps added-only hunks to added markers", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: gitDiff("src/app.ts", ["@@ -1,2 +1,3 @@", " one", "+two", " three"].join("\n")),
      lineCount: 3,
      relativePath: "src/app.ts",
    });

    expect(result.markers).toEqual([
      expect.objectContaining({
        kind: "added",
        lineNumber: 2,
      }),
    ]);
  });

  it("maps deleted-only hunks to the nearest current line", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: gitDiff("src/app.ts", ["@@ -1,3 +1,2 @@", " one", "-two", " three"].join("\n")),
      lineCount: 2,
      relativePath: "src/app.ts",
    });

    expect(result.markers).toEqual([
      expect.objectContaining({
        kind: "deleted",
        lineNumber: 2,
      }),
    ]);
  });

  it("handles deletion at EOF", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: gitDiff("src/app.ts", ["@@ -1,3 +1,2 @@", " one", " two", "-three"].join("\n")),
      lineCount: 2,
      relativePath: "src/app.ts",
    });

    expect(result.markers).toEqual([
      expect.objectContaining({
        kind: "deleted",
        lineNumber: 2,
      }),
    ]);
  });

  it("matches paths with a and b prefixes stripped", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1,2 @@",
        " one",
        "+two",
      ].join("\n"),
      lineCount: 2,
      relativePath: "b/src/app.ts",
    });

    expect(result.markers).toEqual([
      expect.objectContaining({
        kind: "added",
        lineNumber: 2,
      }),
    ]);
  });

  it("numbers hunks by their position within the file diff", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: gitDiff(
        "src/multi.ts",
        [
          "@@ -1,2 +1,2 @@",
          "-one",
          "+one changed",
          " two",
          "@@ -5,2 +5,2 @@",
          " five",
          "-six",
          "+six changed",
        ].join("\n"),
      ),
      lineCount: 6,
      relativePath: "src/multi.ts",
    });

    const hunks = [...result.hunksById.values()].toSorted((a, b) => a.position - b.position);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.position).toBe(1);
    expect(hunks[0]?.totalHunks).toBe(2);
    expect(hunks[1]?.position).toBe(2);
    expect(hunks[1]?.totalHunks).toBe(2);
  });

  it("includes deleted-only hunks in hunk navigation ordering", () => {
    const result = buildWorkspaceFileDiffMarkers({
      diff: gitDiff(
        "src/delete-nav.ts",
        [
          "@@ -1,2 +1,2 @@",
          "-one",
          "+one changed",
          " two",
          "@@ -5,2 +5,1 @@",
          " five",
          "-six",
        ].join("\n"),
      ),
      lineCount: 5,
      relativePath: "src/delete-nav.ts",
    });

    expect(result.markers).toEqual([
      expect.objectContaining({
        kind: "modified",
        lineNumber: 1,
      }),
      expect.objectContaining({
        kind: "deleted",
        lineNumber: 5,
      }),
    ]);

    const hunks = [...result.hunksById.values()].toSorted((a, b) => a.position - b.position);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toEqual(
      expect.objectContaining({
        anchorLine: 1,
        position: 1,
        totalHunks: 2,
      }),
    );
    expect(hunks[1]).toEqual(
      expect.objectContaining({
        anchorLine: 5,
        position: 2,
        totalHunks: 2,
      }),
    );
  });

  it("returns no markers on parse failure or unrelated file diff", () => {
    expect(
      buildWorkspaceFileDiffMarkers({
        diff: "not a diff",
        lineCount: 3,
        relativePath: "src/app.ts",
      }).markers,
    ).toEqual([]);

    expect(
      buildWorkspaceFileDiffMarkers({
        diff: gitDiff("src/other.ts", ["@@ -1 +1,2 @@", " one", "+two"].join("\n")),
        lineCount: 2,
        relativePath: "src/app.ts",
      }).markers,
    ).toEqual([]);

    expect(
      buildWorkspaceFileDiffMarkers({
        diff: `${gitDiff(
          "src/app.ts",
          ["@@ -1 +1,2 @@", " one", "+two"].join("\n"),
        )}\n\n[truncated]`,
        lineCount: 2,
        relativePath: "src/app.ts",
      }).markers,
    ).toEqual([]);
  });
});
