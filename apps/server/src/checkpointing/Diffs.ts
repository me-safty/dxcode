import { parsePatchFiles } from "@pierre/diffs";

export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * A submodule entry detected in a unified diff, with the old and new commit SHAs.
 * Used to expand submodule changes into individual file diffs.
 */
export interface SubmoduleCommitChange {
  readonly path: string;
  readonly fromCommit: string | null;
  readonly toCommit: string | null;
}

/** Match `Subproject commit <sha>` lines in unified diff hunks. */
const SUBPROJECT_COMMIT_RE = /^Subproject commit ([0-9a-f]+)/;

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const parsedPatches = parsePatchFiles(normalized);
  const files = parsedPatches.flatMap((patch) =>
    patch.files.map((file) => ({
      path: file.name,
      additions: file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
      deletions: file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
    })),
  );

  // Remove submodule parent entries when expanded child files exist.
  // e.g. if both "submodules/pm-core" and "submodules/pm-core/src/file.ts" are
  // present, drop the parent so the tree shows individual files instead.
  const result = files.filter(
    (file) => !files.some((other) => other.path.startsWith(`${file.path}/`)),
  );

  return result.toSorted((left, right) => left.path.localeCompare(right.path));
}

/**
 * Extract submodule commit changes from a unified diff.
 * These are entries where the diff shows `Subproject commit` lines
 * (mode 160000 gitlinks).
 */
export function extractSubmoduleChanges(diff: string): ReadonlyArray<SubmoduleCommitChange> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];

  const changes: SubmoduleCommitChange[] = [];
  // Split by `diff --git` headers.
  const fileDiffs = normalized.split(/(?=^diff --git )/m);

  for (const fileDiff of fileDiffs) {
    if (!fileDiff.startsWith("diff --git ")) continue;
    // Check for mode 160000 (gitlink / submodule).
    if (!/\b160000\b/.test(fileDiff)) continue;

    // Extract path from "diff --git a/<path> b/<path>".
    const headerMatch = fileDiff.match(/^diff --git a\/(.+?) b\/(.+)/m);
    if (!headerMatch) continue;
    const filePath = headerMatch[2]!;

    let fromCommit: string | null = null;
    let toCommit: string | null = null;

    for (const line of fileDiff.split("\n")) {
      if (line.startsWith("-Subproject commit ")) {
        const m = line.slice(1).match(SUBPROJECT_COMMIT_RE);
        if (m) fromCommit = m[1]!;
      } else if (line.startsWith("+Subproject commit ")) {
        const m = line.slice(1).match(SUBPROJECT_COMMIT_RE);
        if (m) toCommit = m[1]!;
      }
    }

    if (fromCommit || toCommit) {
      changes.push({ path: filePath, fromCommit, toCommit });
    }
  }

  return changes;
}
