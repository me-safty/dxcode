import {
  ProviderInstanceId,
  ReviewStackSnapshotId,
  ThreadId,
  type ReviewStackSnapshotMetadata,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { filterReviewStackHistory } from "./ReviewStackPanel.logic";

function snapshot(
  snapshotId: string,
  target: ReviewStackSnapshotMetadata["target"],
  ignoreWhitespace: boolean,
): ReviewStackSnapshotMetadata {
  return {
    snapshotId: ReviewStackSnapshotId.make(snapshotId),
    threadId: ThreadId.make("thread-1"),
    target,
    scopeKey: JSON.stringify({ target, resolvedBase: null, ignoreWhitespace }),
    sourceHash: "hash",
    sourceTruncated: false,
    status: "completed",
    stage: "completed",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    errorMessage: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    startedAt: "2026-07-19T00:00:00.000Z",
    completedAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  };
}

describe("filterReviewStackHistory", () => {
  it("excludes stale results from another target or whitespace mode", () => {
    const target = { _tag: "commit" as const, sha: "a".repeat(40) };
    const otherTarget = { _tag: "commit" as const, sha: "b".repeat(40) };

    expect(
      filterReviewStackHistory(
        [
          snapshot("current", target, false),
          snapshot("other", otherTarget, false),
          snapshot("whitespace", target, true),
        ],
        { threadId: ThreadId.make("thread-1"), target, ignoreWhitespace: false },
      ).map((item) => item.snapshotId),
    ).toEqual(["current"]);
  });
});
