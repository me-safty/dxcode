import { buildReviewListItems, type ReviewRenderableFile } from "./reviewModel";

/** REV-007 automated proxy thresholds — see scratch/android-parity/perf-results.adoc */
export const REVIEW_PERF_GATE = {
  fileCount: 10,
  linesPerFile: 55,
  /** Sustained scroll jank threshold from requirements.adoc REV-007 */
  sustainedJankThresholdMs: 300,
  /** Single list-flatten rebuild budget (Hermes proxy; well under frame budget) */
  listBuildBudgetMs: 50,
  warmupIterations: 1,
  measuredIterations: 5,
} as const;

export function buildReviewPerfGateFiles(): ReadonlyArray<ReviewRenderableFile> {
  return Array.from({ length: REVIEW_PERF_GATE.fileCount }, (_, fileIndex) => {
    const path = `src/pkg/file-${fileIndex}.ts`;
    const rows = [
      {
        kind: "hunk" as const,
        id: `${path}:hunk-1`,
        header: `@@ -1,1 +1,${REVIEW_PERF_GATE.linesPerFile} @@`,
        context: null,
      },
      ...Array.from({ length: REVIEW_PERF_GATE.linesPerFile }, (__, lineIndex) => ({
        kind: "line" as const,
        id: `${path}:line-${lineIndex}`,
        change: (lineIndex % 3 === 0 ? "delete" : lineIndex % 3 === 1 ? "add" : "context") as
          | "add"
          | "delete"
          | "context",
        oldLineNumber: lineIndex % 3 === 1 ? null : lineIndex + 1,
        newLineNumber: lineIndex % 3 === 0 ? null : lineIndex + 1,
        content: `export const value${fileIndex}_${lineIndex} = ${lineIndex};`,
        additionTokenIndex: lineIndex % 3 === 1 ? lineIndex : null,
        deletionTokenIndex: lineIndex % 3 === 0 ? lineIndex : null,
        comparison: null,
      })),
    ];

    return {
      id: path,
      cacheKey: path,
      path,
      previousPath: null,
      changeType: "change" as const,
      additions: REVIEW_PERF_GATE.linesPerFile,
      deletions: Math.floor(REVIEW_PERF_GATE.linesPerFile / 3),
      languageHint: "typescript",
      additionLines: [],
      deletionLines: [],
      rows,
    };
  });
}

export function measureReviewListBuildMs(files: ReadonlyArray<ReviewRenderableFile>): number {
  const startedAt = performance.now();
  buildReviewListItems({
    files,
    expandedFileIds: files.map((file) => file.id),
    revealedLargeFileIds: files.map((file) => file.id),
  });
  return performance.now() - startedAt;
}

export function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

export interface ReviewPerfGateMeasurement {
  readonly fileCount: number;
  readonly totalLineRows: number;
  readonly listItemCount: number;
  readonly medianBuildMs: number;
  readonly samplesMs: ReadonlyArray<number>;
}

export function runReviewPerfGateMeasurement(): ReviewPerfGateMeasurement {
  const files = buildReviewPerfGateFiles();
  const expandedFileIds = files.map((file) => file.id);

  for (let index = 0; index < REVIEW_PERF_GATE.warmupIterations; index += 1) {
    buildReviewListItems({
      files,
      expandedFileIds,
      revealedLargeFileIds: expandedFileIds,
    });
  }

  const samplesMs: number[] = [];
  let listItemCount = 0;
  for (let index = 0; index < REVIEW_PERF_GATE.measuredIterations; index += 1) {
    const startedAt = performance.now();
    const items = buildReviewListItems({
      files,
      expandedFileIds,
      revealedLargeFileIds: expandedFileIds,
    });
    samplesMs.push(performance.now() - startedAt);
    listItemCount = items.length;
  }

  const totalLineRows = files.reduce(
    (count, file) => count + file.rows.filter((row) => row.kind === "line").length,
    0,
  );

  return {
    fileCount: files.length,
    totalLineRows,
    listItemCount,
    medianBuildMs: median(samplesMs),
    samplesMs,
  };
}
