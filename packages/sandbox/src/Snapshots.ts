import type { SandboxSnapshotDescriptor } from "@t3tools/contracts";

export interface SandboxSnapshotSelectionInput {
  readonly projectKey: string;
  readonly sourceBranch: string;
  readonly sourceCommit?: string;
  readonly now?: Date;
  readonly maxAgeMs?: number;
}

function timeValue(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSandboxSnapshotExpired(
  snapshot: SandboxSnapshotDescriptor,
  now = new Date(),
): boolean {
  const expiresAt = timeValue(snapshot.expiresAt);
  return expiresAt !== null && expiresAt <= now.getTime();
}

export function isSandboxSnapshotStale(
  snapshot: SandboxSnapshotDescriptor,
  input: { readonly now?: Date; readonly maxAgeMs?: number },
): boolean {
  if (snapshot.status === "stale") {
    return true;
  }
  if (snapshot.status !== "ready") {
    return false;
  }
  if (isSandboxSnapshotExpired(snapshot, input.now)) {
    return true;
  }
  if (input.maxAgeMs === undefined) {
    return false;
  }

  const createdAt = timeValue(snapshot.createdAt);
  return createdAt === null || (input.now ?? new Date()).getTime() - createdAt > input.maxAgeMs;
}

export function isSandboxSnapshotUsable(
  snapshot: SandboxSnapshotDescriptor,
  input: SandboxSnapshotSelectionInput,
): boolean {
  return (
    snapshot.status === "ready" &&
    snapshot.projectKey === input.projectKey &&
    snapshot.sourceBranch === input.sourceBranch &&
    !isSandboxSnapshotStale(snapshot, input)
  );
}

export function selectSandboxSnapshot(
  snapshots: ReadonlyArray<SandboxSnapshotDescriptor>,
  input: SandboxSnapshotSelectionInput,
): SandboxSnapshotDescriptor | null {
  const usable = snapshots.filter((snapshot) => isSandboxSnapshotUsable(snapshot, input));
  usable.sort((left, right) => {
    const leftCommitMatch =
      input.sourceCommit !== undefined && left.sourceCommit === input.sourceCommit;
    const rightCommitMatch =
      input.sourceCommit !== undefined && right.sourceCommit === input.sourceCommit;
    if (leftCommitMatch !== rightCommitMatch) {
      return leftCommitMatch ? -1 : 1;
    }
    return (timeValue(right.createdAt) ?? 0) - (timeValue(left.createdAt) ?? 0);
  });
  return usable[0] ?? null;
}
