import type { ReviewStackAnchor } from "@t3tools/contracts";

const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stableId(index: number): string {
  return `anchor-${String(index + 1).padStart(4, "0")}`;
}

function pathFromMarker(line: string): string | null {
  const value = line.slice(4).split("\t", 1)[0] ?? "";
  if (value === "/dev/null") return null;
  return value.replace(/^[ab]\//, "");
}

/** Parse a unified diff into deterministic, opaque range anchors. */
export function parseReviewStackAnchors(source: string): ReadonlyArray<ReviewStackAnchor> {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const anchors: ReviewStackAnchor[] = [];
  let fileStart = -1;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let hunkStart = -1;

  const addAnchor = (anchor: Omit<ReviewStackAnchor, "id">) => {
    anchors.push({ id: stableId(anchors.length), ...anchor });
  };

  const flushHunk = (end: number) => {
    if (hunkStart < 0) return;
    const header = HUNK_HEADER.exec(lines[hunkStart] ?? "");
    if (header && (newPath ?? oldPath)) {
      const displayOldPath = oldPath ?? newPath!;
      const displayNewPath = newPath ?? oldPath!;
      addAnchor({
        path: newPath ?? oldPath!,
        previousPath: oldPath !== newPath ? oldPath : null,
        kind: "hunk",
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? 1),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? 1),
        patch: [
          `diff --git a/${displayOldPath} b/${displayNewPath}`,
          `--- ${oldPath === null ? "/dev/null" : `a/${oldPath}`}`,
          `+++ ${newPath === null ? "/dev/null" : `b/${newPath}`}`,
          ...lines.slice(hunkStart, end),
        ]
          .join("\n")
          .trimEnd(),
      });
    }
    hunkStart = -1;
  };

  const flushFile = (end: number) => {
    flushHunk(end);
    if (fileStart < 0 || !(newPath ?? oldPath)) return;
    const fileLines = lines.slice(fileStart, end);
    const hasBinary = fileLines.some(
      (line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"),
    );
    const hasRename = fileLines.some((line) => line.startsWith("rename from "));
    const hasHunks = fileLines.some((line) => HUNK_HEADER.test(line));
    if (!hasHunks) {
      addAnchor({
        path: newPath ?? oldPath!,
        previousPath: oldPath !== newPath ? oldPath : null,
        kind: hasBinary ? "binary" : hasRename ? "rename" : "metadata",
        oldStart: null,
        oldLines: null,
        newStart: null,
        newLines: null,
        patch: fileLines.join("\n").trimEnd(),
      });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const header = DIFF_HEADER.exec(line);
    if (header) {
      flushFile(index);
      fileStart = index;
      oldPath = header[1] ?? null;
      newPath = header[2] ?? null;
      continue;
    }
    if (fileStart < 0) continue;
    if (line.startsWith("--- ")) oldPath = pathFromMarker(line);
    if (line.startsWith("+++ ")) newPath = pathFromMarker(line);
    if (HUNK_HEADER.test(line)) {
      flushHunk(index);
      hunkStart = index;
    }
  }
  flushFile(lines.length);
  return anchors;
}
