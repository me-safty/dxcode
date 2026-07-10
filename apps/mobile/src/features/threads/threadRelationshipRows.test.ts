import type { ThreadRelationshipWalkRow } from "@t3tools/client-runtime/state/thread-relationships";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { orderThreadRelationshipRows } from "./threadRelationshipRows";

const parentThreadId = ThreadId.make("parent");

function relationshipRow(threadId: string): ThreadRelationshipWalkRow {
  const relatedThreadId = ThreadId.make(threadId);
  return {
    threadId: relatedThreadId,
    fromThreadId: parentThreadId,
    depth: 1,
    edge: {
      sourceThreadId: parentThreadId,
      targetThreadId: relatedThreadId,
      kind: "subagent",
      status: null,
    },
  };
}

describe("orderThreadRelationshipRows", () => {
  it("prioritizes the merge target without relying on Array.prototype.toSorted", () => {
    const first = relationshipRow("first");
    const mergeTarget = relationshipRow("merge-target");
    const last = relationshipRow("last");
    const rows = [first, mergeTarget, last];
    Object.defineProperty(rows, "toSorted", { value: undefined });

    const ordered = orderThreadRelationshipRows(rows, mergeTarget.threadId);

    expect(ordered.map((row) => row.threadId)).toEqual([
      mergeTarget.threadId,
      first.threadId,
      last.threadId,
    ]);
    expect(rows.map((row) => row.threadId)).toEqual([
      first.threadId,
      mergeTarget.threadId,
      last.threadId,
    ]);
  });
});
