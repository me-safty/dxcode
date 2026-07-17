import type { ReviewChangeArea, ReviewWorkingTreeManifest } from "@t3tools/contracts";

export interface OptimisticWorkingTreeTransfer {
  readonly from: ReviewChangeArea;
  readonly path: string;
}

const oppositeArea = (area: ReviewChangeArea): ReviewChangeArea =>
  area === "unstaged" ? "staged" : "unstaged";

const compareByPath = (
  left: ReviewWorkingTreeManifest["staged"][number],
  right: ReviewWorkingTreeManifest["staged"][number],
) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" });

export function applyOptimisticWorkingTreeTransfers(
  manifest: ReviewWorkingTreeManifest | undefined,
  transfers: ReadonlyArray<OptimisticWorkingTreeTransfer>,
): ReviewWorkingTreeManifest | undefined {
  if (!manifest || transfers.length === 0) return manifest;

  const staged = [...manifest.staged];
  const unstaged = [...manifest.unstaged];
  const filesByArea = { staged, unstaged };

  for (const transfer of transfers) {
    const source = filesByArea[transfer.from];
    const sourceIndex = source.findIndex((file) => file.path === transfer.path);
    if (sourceIndex < 0) continue;
    const [file] = source.splice(sourceIndex, 1);
    const target = filesByArea[oppositeArea(transfer.from)];
    if (file && !target.some((candidate) => candidate.path === file.path)) target.push(file);
  }

  return {
    ...manifest,
    staged: staged.toSorted(compareByPath),
    unstaged: unstaged.toSorted(compareByPath),
  };
}

export function retainUnsettledWorkingTreeTransfers(
  manifest: ReviewWorkingTreeManifest,
  transfers: ReadonlyArray<OptimisticWorkingTreeTransfer>,
): ReadonlyArray<OptimisticWorkingTreeTransfer> {
  return transfers.filter((transfer) =>
    manifest[transfer.from].some((file) => file.path === transfer.path),
  );
}
