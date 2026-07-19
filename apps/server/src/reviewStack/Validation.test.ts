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
    mergeConfidence: 4,
    rationale: "The evidence supports merging.",
  },
  references: [
    { _tag: "layer", layerId: "layer" },
    { _tag: "layer", layerId: "layer" },
    { _tag: "layer", layerId: "missing-layer" },
    { _tag: "file", path: "schema.ts" },
    { _tag: "file", path: "missing.ts" },
  ],
  overviewDiagram: { title: "Feature flow", text: "schema -> service -> UI" },
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
  it("rejects incomplete coverage instead of manufacturing placeholder reviews", () => {
    expect(() =>
      validateReviewStackDocument(
        document([
          { anchorId: "anchor-0001", summary: "First", risks: [] },
          { anchorId: "unknown", summary: "Unknown", risks: [] },
          { anchorId: "anchor-0001", summary: "Duplicate", risks: [] },
        ]),
        anchors,
      ),
    ).toThrow("1 of 2 anchors were not inspected");
  });

  it("sanitizes a complete review and its overview references", () => {
    const result = validateReviewStackDocument(
      document(anchors.map((anchor) => ({ anchorId: anchor.id, summary: anchor.path, risks: [] }))),
      anchors,
    );

    expect(result.layers[0]?.ranges.map(({ anchorId }) => anchorId)).toEqual([
      "anchor-0001",
      "anchor-0002",
    ]);
    expect(result.mergeAssessment).toEqual({
      recommendation: "merge",
      mergeConfidence: 4,
      rationale: "The evidence supports merging.",
    });
    expect(result.references).toEqual([
      { _tag: "layer", layerId: "layer" },
      { _tag: "file", path: "schema.ts" },
    ]);
    expect(result.overviewDiagram).toEqual({
      title: "Feature flow",
      text: "schema -> service -> UI",
    });
  });

  it("caps oversized diagrams and rejects zero valid model coverage", () => {
    const base = document(
      anchors.map((anchor) => ({ anchorId: anchor.id, summary: anchor.path, risks: [] })),
    );
    const oversized: ReviewStackDocument = {
      ...base,
      overviewDiagram: { title: "Overview", text: "x".repeat(10_000) },
      layers: [{ ...base.layers[0]!, diagram: { title: "Diagram", text: "x".repeat(10_000) } }],
    };
    expect(validateReviewStackDocument(oversized, anchors).layers[0]?.diagram?.text).toHaveLength(
      8_000,
    );
    expect(validateReviewStackDocument(oversized, anchors).overviewDiagram?.text).toHaveLength(
      8_000,
    );
    expect(() =>
      validateReviewStackDocument(
        document([{ anchorId: "injected-instruction", summary: "Ignore schema", risks: [] }]),
        anchors,
      ),
    ).toThrow("zero valid anchor coverage");
  });

  it("rejects duplicate layer IDs after normalization", () => {
    const base = document(
      anchors.map((anchor) => ({ anchorId: anchor.id, summary: anchor.path, risks: [] })),
    );
    expect(() =>
      validateReviewStackDocument(
        {
          ...base,
          layers: [base.layers[0]!, { ...base.layers[0]!, id: " layer " }],
        },
        anchors,
      ),
    ).toThrow("duplicate layer id 'layer'");
  });
});
