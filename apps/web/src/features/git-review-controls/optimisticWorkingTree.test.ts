import { describe, expect, it } from "vite-plus/test";

import type { ReviewWorkingTreeManifest } from "@t3tools/contracts";
import {
  applyOptimisticWorkingTreeTransfers,
  retainUnsettledWorkingTreeTransfers,
} from "./optimisticWorkingTree";

const file = {
  path: "src/app.ts",
  previousPath: null,
  kind: "modified" as const,
  insertions: 1,
  deletions: 0,
};

describe("optimistic working tree", () => {
  it("moves a file immediately without duplicating a partially staged path", () => {
    const manifest: ReviewWorkingTreeManifest = {
      staged: [{ ...file, insertions: 2 }],
      unstaged: [file],
      truncated: false,
    };

    const next = applyOptimisticWorkingTreeTransfers(manifest, [
      { from: "unstaged", path: file.path },
    ]);

    expect(next?.unstaged).toEqual([]);
    expect(next?.staged).toEqual([{ ...file, insertions: 2 }]);
  });

  it("retains transfers until refreshed data removes the source entry", () => {
    const transfer = { from: "unstaged" as const, path: file.path };
    const stale: ReviewWorkingTreeManifest = {
      staged: [],
      unstaged: [file],
      truncated: false,
    };
    const refreshed: ReviewWorkingTreeManifest = {
      staged: [file],
      unstaged: [],
      truncated: false,
    };

    expect(retainUnsettledWorkingTreeTransfers(stale, [transfer])).toEqual([transfer]);
    expect(retainUnsettledWorkingTreeTransfers(refreshed, [transfer])).toEqual([]);
  });

  it("inserts staged and unstaged files directly into final path order", () => {
    const makeFile = (path: string) => ({ ...file, path });
    const manifest: ReviewWorkingTreeManifest = {
      staged: [makeFile("src/file1.ts"), makeFile("src/file10.ts"), makeFile("src/file2.ts")],
      unstaged: [makeFile("src/app.ts"), makeFile("src/z.ts")],
      truncated: false,
    };

    const staged = applyOptimisticWorkingTreeTransfers(manifest, [
      { from: "unstaged", path: "src/app.ts" },
    ]);
    expect(staged?.staged.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "src/file1.ts",
      "src/file2.ts",
      "src/file10.ts",
    ]);

    const unstaged = applyOptimisticWorkingTreeTransfers(manifest, [
      { from: "staged", path: "src/file2.ts" },
    ]);
    expect(unstaged?.unstaged.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "src/file2.ts",
      "src/z.ts",
    ]);
  });
});
