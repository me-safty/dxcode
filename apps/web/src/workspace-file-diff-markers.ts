import {
  parsePatchFiles,
  type ChangeContent,
  type ContextContent,
  type FileDiffMetadata,
  type Hunk,
} from "@pierre/diffs";

export type WorkspaceFileDiffMarkerKind = "added" | "modified" | "deleted";

export interface WorkspaceFileDiffLineMarker {
  readonly hunkId: string;
  readonly kind: WorkspaceFileDiffMarkerKind;
  readonly lineNumber: number;
}

export interface WorkspaceFileInlineDiffHunk {
  readonly anchorLine: number;
  readonly fileDiff: FileDiffMetadata;
  readonly id: string;
  readonly position: number;
  readonly totalHunks: number;
}

export interface WorkspaceFileDiffMarkerResult {
  readonly hunksById: ReadonlyMap<string, WorkspaceFileInlineDiffHunk>;
  readonly markers: ReadonlyArray<WorkspaceFileDiffLineMarker>;
  readonly markersByLine: ReadonlyMap<number, WorkspaceFileDiffLineMarker>;
}

export interface BuildWorkspaceFileDiffMarkersInput {
  readonly diff: string | null | undefined;
  readonly lineCount: number;
  readonly relativePath: string;
}

const EMPTY_RESULT: WorkspaceFileDiffMarkerResult = Object.freeze({
  hunksById: new Map(),
  markers: [],
  markersByLine: new Map(),
});

function normalizeDiffPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^(?:a|b)\//, "")
    .replace(/\/+$/g, "");
}

function clampLineNumber(lineNumber: number, lineCount: number): number | null {
  if (lineCount <= 0) {
    return null;
  }
  return Math.max(1, Math.min(lineNumber, lineCount));
}

function markerKindPriority(kind: WorkspaceFileDiffMarkerKind): number {
  switch (kind) {
    case "deleted":
      return 3;
    case "modified":
      return 2;
    case "added":
      return 1;
  }
}

function setMarker(
  markersByLine: Map<number, WorkspaceFileDiffLineMarker>,
  marker: WorkspaceFileDiffLineMarker,
) {
  const existing = markersByLine.get(marker.lineNumber);
  if (existing && markerKindPriority(existing.kind) >= markerKindPriority(marker.kind)) {
    return;
  }
  markersByLine.set(marker.lineNumber, marker);
}

function buildHunkId(input: { hunk: Hunk; hunkIndex: number; path: string }): string {
  return [
    "workspace-file-diff",
    input.path,
    input.hunkIndex,
    input.hunk.deletionStart,
    input.hunk.deletionCount,
    input.hunk.additionStart,
    input.hunk.additionCount,
  ].join(":");
}

function adjustHunkContentIndexes(
  hunkContent: ReadonlyArray<ContextContent | ChangeContent>,
  input: { additionLineIndex: number; deletionLineIndex: number },
): Array<ContextContent | ChangeContent> {
  return hunkContent.map((content) => {
    if (content.type === "context") {
      return {
        ...content,
        additionLineIndex: content.additionLineIndex - input.additionLineIndex,
        deletionLineIndex: content.deletionLineIndex - input.deletionLineIndex,
      };
    }

    return {
      ...content,
      additionLineIndex: content.additionLineIndex - input.additionLineIndex,
      deletionLineIndex: content.deletionLineIndex - input.deletionLineIndex,
    };
  });
}

function sliceFileDiffToHunk(
  fileDiff: FileDiffMetadata,
  hunk: Hunk,
  hunkIndex: number,
): FileDiffMetadata {
  const additionLines = fileDiff.additionLines.slice(
    hunk.additionLineIndex,
    hunk.additionLineIndex + hunk.additionCount,
  );
  const deletionLines = fileDiff.deletionLines.slice(
    hunk.deletionLineIndex,
    hunk.deletionLineIndex + hunk.deletionCount,
  );
  const adjustedHunk: Hunk = {
    ...hunk,
    additionLineIndex: 0,
    collapsedBefore: 0,
    deletionLineIndex: 0,
    hunkContent: adjustHunkContentIndexes(hunk.hunkContent, {
      additionLineIndex: hunk.additionLineIndex,
      deletionLineIndex: hunk.deletionLineIndex,
    }),
    splitLineStart: 0,
    unifiedLineStart: 0,
  };

  return {
    ...fileDiff,
    additionLines,
    cacheKey: `${fileDiff.cacheKey ?? fileDiff.name}:inline-hunk:${hunkIndex}`,
    deletionLines,
    hunks: [adjustedHunk],
    isPartial: true,
    splitLineCount: adjustedHunk.splitLineCount,
    unifiedLineCount: adjustedHunk.unifiedLineCount,
  };
}

function findPreviewFileDiff(diff: string, relativePath: string): FileDiffMetadata | null {
  const normalizedPath = normalizeDiffPath(relativePath);
  const parsedPatches = parsePatchFiles(diff, `workspace-file-preview:${normalizedPath}`, true);
  const files = parsedPatches.flatMap((patch) => patch.files);

  return (
    files.find((file) => normalizeDiffPath(file.name) === normalizedPath) ??
    files.find(
      (file) =>
        file.type !== "rename-pure" &&
        file.type !== "rename-changed" &&
        file.prevName !== undefined &&
        normalizeDiffPath(file.prevName) === normalizedPath,
    ) ??
    null
  );
}

function addRangeMarkers(input: {
  readonly endLine: number;
  readonly hunkId: string;
  readonly kind: WorkspaceFileDiffMarkerKind;
  readonly lineCount: number;
  readonly markersByLine: Map<number, WorkspaceFileDiffLineMarker>;
  readonly startLine: number;
}) {
  const startLine = clampLineNumber(input.startLine, input.lineCount);
  const endLine = clampLineNumber(input.endLine, input.lineCount);
  if (startLine === null || endLine === null) {
    return;
  }

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    setMarker(input.markersByLine, {
      hunkId: input.hunkId,
      kind: input.kind,
      lineNumber,
    });
  }
}

function collectHunkMarkers(input: {
  readonly hunk: Hunk;
  readonly hunkId: string;
  readonly lineCount: number;
  readonly markersByLine: Map<number, WorkspaceFileDiffLineMarker>;
}) {
  let additionLineNumber = input.hunk.additionStart;

  for (const content of input.hunk.hunkContent) {
    if (content.type === "context") {
      additionLineNumber += content.lines;
      continue;
    }

    if (content.additions > 0) {
      addRangeMarkers({
        endLine: additionLineNumber + content.additions - 1,
        hunkId: input.hunkId,
        kind: content.deletions > 0 ? "modified" : "added",
        lineCount: input.lineCount,
        markersByLine: input.markersByLine,
        startLine: additionLineNumber,
      });
    } else if (content.deletions > 0) {
      const anchorLine = clampLineNumber(additionLineNumber, input.lineCount);
      if (anchorLine !== null) {
        setMarker(input.markersByLine, {
          hunkId: input.hunkId,
          kind: "deleted",
          lineNumber: anchorLine,
        });
      }
    }

    additionLineNumber += content.additions;
  }
}

function buildHunksById(input: {
  readonly fileDiff: FileDiffMetadata;
  readonly markers: ReadonlyArray<WorkspaceFileDiffLineMarker>;
}): ReadonlyMap<string, WorkspaceFileInlineDiffHunk> {
  const firstMarkerLineByHunkId = new Map<string, number>();
  for (const marker of input.markers) {
    if (!firstMarkerLineByHunkId.has(marker.hunkId)) {
      firstMarkerLineByHunkId.set(marker.hunkId, marker.lineNumber);
    }
  }

  const candidates: Array<{
    hunkId: string;
    anchorLine: number;
    fileDiff: FileDiffMetadata;
  }> = [];
  input.fileDiff.hunks.forEach((hunk, hunkIndex) => {
    const hunkId = buildHunkId({
      hunk,
      hunkIndex,
      path: normalizeDiffPath(input.fileDiff.name),
    });
    const anchorLine = firstMarkerLineByHunkId.get(hunkId);
    if (anchorLine === undefined) {
      return;
    }
    candidates.push({
      hunkId,
      anchorLine,
      fileDiff: sliceFileDiffToHunk(input.fileDiff, hunk, hunkIndex),
    });
  });

  const hunksById = new Map<string, WorkspaceFileInlineDiffHunk>();
  const totalHunks = candidates.length;
  candidates.forEach((candidate, index) => {
    hunksById.set(candidate.hunkId, {
      anchorLine: candidate.anchorLine,
      fileDiff: candidate.fileDiff,
      id: candidate.hunkId,
      position: index + 1,
      totalHunks,
    });
  });

  return hunksById;
}

export function buildWorkspaceFileDiffMarkers(
  input: BuildWorkspaceFileDiffMarkersInput,
): WorkspaceFileDiffMarkerResult {
  const normalizedDiff = input.diff?.trim();
  if (!normalizedDiff || input.lineCount <= 0 || normalizedDiff.includes("[truncated]")) {
    return EMPTY_RESULT;
  }

  let fileDiff: FileDiffMetadata | null = null;
  try {
    fileDiff = findPreviewFileDiff(normalizedDiff, input.relativePath);
  } catch {
    return EMPTY_RESULT;
  }

  if (!fileDiff) {
    return EMPTY_RESULT;
  }

  const markersByLine = new Map<number, WorkspaceFileDiffLineMarker>();
  fileDiff.hunks.forEach((hunk, hunkIndex) => {
    collectHunkMarkers({
      hunk,
      hunkId: buildHunkId({
        hunk,
        hunkIndex,
        path: normalizeDiffPath(fileDiff.name),
      }),
      lineCount: input.lineCount,
      markersByLine,
    });
  });

  const markers = [...markersByLine.values()].toSorted((a, b) => a.lineNumber - b.lineNumber);
  if (markers.length === 0) {
    return EMPTY_RESULT;
  }

  return {
    hunksById: buildHunksById({ fileDiff, markers }),
    markers,
    markersByLine,
  };
}
