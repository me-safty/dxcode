import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ReviewStackDocument,
  ReviewStackEvent,
  ReviewStackRisk,
  ReviewStackStage,
  ReviewStackStatus,
  ReviewStackTarget,
} from "./reviewStack.ts";

const decodeTarget = Schema.decodeUnknownSync(ReviewStackTarget);
const decodeStatus = Schema.decodeUnknownSync(ReviewStackStatus);
const decodeStage = Schema.decodeUnknownSync(ReviewStackStage);
const decodeRisk = Schema.decodeUnknownSync(ReviewStackRisk);
const decodeDocument = Schema.decodeUnknownSync(ReviewStackDocument);
const decodeEvent = Schema.decodeUnknownSync(ReviewStackEvent);

describe("Review stack contracts", () => {
  it("decodes every target", () => {
    expect(decodeTarget({ _tag: "branch", baseRef: null })).toEqual({
      _tag: "branch",
      baseRef: null,
    });
    expect(
      decodeTarget({ _tag: "commit", sha: "0123456789abcdef0123456789abcdef01234567" })._tag,
    ).toBe("commit");
    expect(decodeTarget({ _tag: "working-tree" })).toEqual({ _tag: "working-tree" });
    expect(
      decodeTarget({ _tag: "turn", turnId: "turn-1", fromTurnCount: 1, toTurnCount: 2 })._tag,
    ).toBe("turn");
    expect(() =>
      decodeTarget({ _tag: "turn", turnId: "turn-1", fromTurnCount: -1, toTurnCount: 2 }),
    ).toThrow();
  });

  it("decodes statuses, stages, risks, layers, and events", () => {
    expect(decodeStatus("running")).toBe("running");
    expect(decodeStage("validating")).toBe("validating");
    expect(
      decodeRisk({
        severity: "high",
        summary: "Race",
        evidence: "Shared state mutates without a guard.",
      }).severity,
    ).toBe("high");
    expect(
      decodeDocument({
        summary: "Two dependent changes with a new schema and service consumer.",
        mergeAssessment: {
          recommendation: "merge",
          confidence: 4,
          rationale: "The implementation is covered and has no blocking risks.",
        },
        references: [
          { _tag: "layer", layerId: "foundation" },
          { _tag: "file", path: "schema.ts" },
        ],
        layers: [
          {
            id: "foundation",
            title: "Foundation",
            summary: "Adds schema.",
            ranges: [{ anchorId: "anchor-0001", summary: "Schema.", risks: [] }],
            diagram: { title: "Flow", text: "schema -> service" },
          },
        ],
      }).layers,
    ).toHaveLength(1);
    expect(() =>
      decodeDocument({
        summary: "Invalid confidence.",
        mergeAssessment: {
          recommendation: "merge",
          confidence: 6,
          rationale: "Outside the supported scale.",
        },
        layers: [],
      }),
    ).toThrow();
    expect(
      decodeEvent({
        snapshotId: "snapshot-1",
        threadId: "thread-1",
        status: "completed",
        stage: "completed",
        updatedAt: "2026-07-18T00:00:00.000Z",
      }).status,
    ).toBe("completed");
  });

  it("keeps review documents from before merge assessments readable", () => {
    expect(
      decodeDocument({
        summary: "Legacy review.",
        layers: [],
      }),
    ).toEqual({ summary: "Legacy review.", layers: [] });
  });
});
