import { assert, describe, it } from "vite-plus/test";

import { getProjectFilePickerMatches } from "./ProjectFilePicker.logic";

function pathsForQuery(entries: Parameters<typeof getProjectFilePickerMatches>[0], query: string) {
  return getProjectFilePickerMatches(entries, query).map(({ name, path }) => ({ name, path }));
}

const entries = [
  { kind: "directory", path: "apps/web/src" },
  { kind: "file", path: "apps/web/src/index.ts" },
  { kind: "file", path: "packages/shared/src/index.ts" },
  { kind: "file", path: "README.md" },
  { kind: "file", path: ".gitignore" },
] as const;

describe("getProjectFilePickerMatches", () => {
  it("returns files only and preserves index order for an empty query", () => {
    assert.deepEqual(pathsForQuery(entries, ""), [
      { name: "index.ts", path: "apps/web/src/index.ts" },
      { name: "index.ts", path: "packages/shared/src/index.ts" },
      { name: "README.md", path: "README.md" },
      { name: ".gitignore", path: ".gitignore" },
    ]);
  });

  it("matches against both file names and paths", () => {
    assert.deepEqual(pathsForQuery(entries, "shared"), [
      { name: "index.ts", path: "packages/shared/src/index.ts" },
    ]);
    assert.deepEqual(pathsForQuery(entries, "read"), [{ name: "README.md", path: "README.md" }]);
  });

  it("supports space-separated path tokens and a result limit", () => {
    assert.deepEqual(
      getProjectFilePickerMatches(entries, "src index", 1).map(({ name, path }) => ({
        name,
        path,
      })),
      [{ name: "index.ts", path: "apps/web/src/index.ts" }],
    );
  });

  it("matches ordered characters while allowing skipped characters", () => {
    const fuzzyEntries = [
      { kind: "file", path: "src/TestFlags.tsx" },
      { kind: "file", path: "src/SubtestFlow.tsx" },
      { kind: "file", path: "src/useSubtestFlags.ts" },
      {
        kind: "file",
        path: "src/useSubtestFlags/useTabActivity.ts",
      },
      { kind: "file", path: "src/TestResults.tsx" },
    ] as const;

    assert.deepEqual(
      pathsForQuery(fuzzyEntries, "testf").map(({ name }) => name),
      ["TestFlags.tsx", "SubtestFlow.tsx", "useSubtestFlags.ts", "useTabActivity.ts"],
    );
    assert.deepEqual(getProjectFilePickerMatches(fuzzyEntries, "tsfl")[0], {
      name: "TestFlags.tsx",
      nameMatchIndices: [0, 2, 4, 5],
      path: "src/TestFlags.tsx",
      pathMatchIndices: [4, 6, 8, 9],
    });
  });

  it("uses the first ordered subsequence for highlighting", () => {
    assert.deepEqual(
      getProjectFilePickerMatches([{ kind: "file", path: "aabba" }], "aba")[0]?.nameMatchIndices,
      [0, 2, 4],
    );
  });
});
