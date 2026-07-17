import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  ReviewDiscardChangesInput,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
  ReviewStagePathsInput,
  ReviewUnstagePathsInput,
} from "./review.ts";
import { ThreadId } from "./baseSchemas.ts";

const threadId = ThreadId.make("thread-review-contract");

const decodePreviewInput = Schema.decodeUnknownSync(ReviewDiffPreviewInput);
const decodeDiscardChanges = Schema.decodeUnknownSync(ReviewDiscardChangesInput);
const decodePreviewResult = Schema.decodeUnknownSync(ReviewDiffPreviewResult);
const decodeStagePaths = Schema.decodeUnknownSync(ReviewStagePathsInput);
const decodeUnstagePaths = Schema.decodeUnknownSync(ReviewUnstagePathsInput);

describe("Review contracts", () => {
  it("decodes staged and unstaged file selections", () => {
    expect(
      decodePreviewInput({
        cwd: "/repo",
        selection: { _tag: "file", area: "staged", path: "src/app.ts" },
      }).selection,
    ).toEqual({ _tag: "file", area: "staged", path: "src/app.ts" });
  });

  it("decodes commit selections", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(
      decodePreviewInput({ cwd: "/repo", selection: { _tag: "commit", sha } }).selection,
    ).toEqual({ _tag: "commit", sha });
  });

  it("allows the same path in both working tree sections", () => {
    const file = {
      path: "src/app.ts",
      previousPath: null,
      kind: "modified",
      insertions: 1,
      deletions: 1,
    };
    const decoded = decodePreviewResult({
      cwd: "/repo",
      generatedAt: DateTime.nowUnsafe(),
      sources: [],
      commits: [],
      workingTree: { staged: [file], unstaged: [file], truncated: false },
    });

    expect(decoded.workingTree.staged[0]?.path).toBe("src/app.ts");
    expect(decoded.workingTree.unstaged[0]?.path).toBe("src/app.ts");
  });

  it("rejects an empty staging request", () => {
    expect(() => decodeStagePaths({ cwd: "/repo", threadId, paths: [] })).toThrow();
    expect(() => decodeUnstagePaths({ cwd: "/repo", threadId, changes: [] })).toThrow();
  });

  it("requires at least one change to discard", () => {
    expect(() => decodeDiscardChanges({ cwd: "/repo", threadId, changes: [] })).toThrow();
    expect(
      decodeDiscardChanges({
        cwd: "/repo",
        threadId,
        changes: [{ path: "src/app.ts", kind: "modified" }],
      }).changes,
    ).toEqual([{ path: "src/app.ts", kind: "modified" }]);
  });
});
