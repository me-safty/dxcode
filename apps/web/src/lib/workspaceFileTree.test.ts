import { describe, expect, it } from "vitest";

import { buildWorkspaceFileTree } from "./workspaceFileTree";

describe("buildWorkspaceFileTree", () => {
  it("builds nested directories and sorts folders before files", () => {
    const tree = buildWorkspaceFileTree({
      entries: [
        { path: "notes/today.md", kind: "file", parentPath: "notes" },
        { path: "README.md", kind: "file" },
        { path: "notes", kind: "directory" },
        { path: "notes/archive", kind: "directory", parentPath: "notes" },
        { path: "notes/archive/old.md", kind: "file", parentPath: "notes/archive" },
      ],
    });

    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "directory:notes",
      "file:README.md",
    ]);
    expect(tree[0]).toMatchObject({
      kind: "directory",
      name: "notes",
      children: [
        { kind: "directory", name: "archive" },
        { kind: "file", name: "today.md" },
      ],
    });
  });

  it("marks changed files and bubbles that state up to parent directories", () => {
    const tree = buildWorkspaceFileTree({
      entries: [
        { path: "docs", kind: "directory" },
        { path: "docs/brief.md", kind: "file", parentPath: "docs" },
        { path: "docs/archive", kind: "directory", parentPath: "docs" },
        { path: "docs/archive/old.md", kind: "file", parentPath: "docs/archive" },
      ],
      changedPaths: new Set(["docs/archive/old.md"]),
    });

    expect(tree[0]).toMatchObject({
      kind: "directory",
      name: "docs",
      changed: true,
      children: [
        { kind: "directory", name: "archive", changed: true },
        { kind: "file", name: "brief.md", changed: false },
      ],
    });
  });
});
