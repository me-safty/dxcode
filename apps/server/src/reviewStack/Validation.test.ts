import type { ReviewStackAnchor, ReviewStackDocument } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { validateReviewStackDocument } from "./Validation.ts";

const anchors: ReadonlyArray<ReviewStackAnchor> = [
  {
    id: "anchor-0001",
    path: "schema.ts",
    previousPath: null,
    kind: "hunk",
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 2,
    patch: "patch 1",
  },
  {
    id: "anchor-0002",
    path: "service.ts",
    previousPath: null,
    kind: "hunk",
    oldStart: 2,
    oldLines: 1,
    newStart: 2,
    newLines: 2,
    patch: "patch 2",
  },
];

const document = (
  ranges: ReviewStackDocument["layers"][number]["ranges"],
): ReviewStackDocument => ({
  summary: "Review",
  mergeAssessment: {
    recommendation: "merge",
    confidence: 4,
    rationale: "The evidence supports merging.",
  },
  references: [
    { _tag: "layer", layerId: "layer" },
    { _tag: "layer", layerId: "layer" },
    { _tag: "layer", layerId: "missing-layer" },
    { _tag: "file", path: "schema.ts" },
    { _tag: "file", path: "missing.ts" },
  ],
  layers: [
    {
      id: "layer",
      title: "Layer",
      summary: "Summary",
      ranges,
      diagram: null,
    },
  ],
});

describe("validateReviewStackDocument", () => {
  it("removes unknown and duplicate IDs, then appends missing anchors", () => {
    const result = validateReviewStackDocument(
      document([
        { anchorId: "anchor-0001", summary: "First", risks: [] },
        { anchorId: "unknown", summary: "Unknown", risks: [] },
        { anchorId: "anchor-0001", summary: "Duplicate", risks: [] },
      ]),
      anchors,
    );

    expect(result.layers[0]?.ranges.map(({ anchorId }) => anchorId)).toEqual(["anchor-0001"]);
    expect(result.layers[1]).toMatchObject({
      id: "other-changes",
      ranges: [{ anchorId: "anchor-0002" }],
    });
    expect(result.mergeAssessment).toEqual({
      recommendation: "merge",
      confidence: 4,
      rationale: "The evidence supports merging.",
    });
    expect(result.references).toEqual([
      { _tag: "layer", layerId: "layer" },
      { _tag: "file", path: "schema.ts" },
    ]);
  });

  it("caps oversized diagrams and rejects zero valid model coverage", () => {
    const base = document([{ anchorId: "anchor-0001", summary: "First", risks: [] }]);
    const oversized: ReviewStackDocument = {
      ...base,
      layers: [{ ...base.layers[0]!, diagram: { title: "Diagram", text: "x".repeat(10_000) } }],
    };
    expect(validateReviewStackDocument(oversized, anchors).layers[0]?.diagram?.text).toHaveLength(
      8_000,
    );
    expect(() =>
      validateReviewStackDocument(
        document([{ anchorId: "injected-instruction", summary: "Ignore schema", risks: [] }]),
        anchors,
      ),
    ).toThrow("zero valid anchor coverage");
  });
});
