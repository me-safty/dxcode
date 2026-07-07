import { describe, expect, it } from "vite-plus/test";

import {
  REVIEW_PERF_GATE,
  buildReviewPerfGateFiles,
  runReviewPerfGateMeasurement,
} from "./reviewPerfGate";

describe("REV-007 review perf gate", () => {
  it("builds a 10-file / 500+ line fixture for the Android JS review tier", () => {
    const files = buildReviewPerfGateFiles();

    expect(files).toHaveLength(REVIEW_PERF_GATE.fileCount);
    const totalLineRows = files.reduce(
      (count, file) => count + file.rows.filter((row) => row.kind === "line").length,
      0,
    );
    expect(totalLineRows).toBeGreaterThanOrEqual(500);
  });

  it("stays under the automated list-build budget (proxy for sustained jank gate)", () => {
    const measurement = runReviewPerfGateMeasurement();

    expect(measurement.listItemCount).toBeGreaterThan(500);
    expect(measurement.medianBuildMs).toBeLessThan(REVIEW_PERF_GATE.listBuildBudgetMs);
    expect(measurement.medianBuildMs).toBeLessThan(REVIEW_PERF_GATE.sustainedJankThresholdMs);
  });
});
