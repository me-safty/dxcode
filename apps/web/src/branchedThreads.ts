import type { MessageId, ThreadId } from "@t3tools/contracts";

export type BranchedThreadKind = "edit" | "retry";

export interface BranchedThreadRecord {
  threadId: ThreadId;
  parentThreadId: ThreadId;
  rootThreadId: ThreadId;
  anchorThreadId: ThreadId;
  sourceThreadId: ThreadId;
  sourceMessageId: MessageId;
  variantGroupId: string;
  kind: BranchedThreadKind;
  createdAt: string;
}

export interface BranchedThreadTreeNode {
  threadId: ThreadId;
  parentThreadId: ThreadId | null;
  kind: BranchedThreadKind | "root";
  createdAt: string;
  children: BranchedThreadTreeNode[];
}

export interface BranchedThreadLineageSelection {
  rootThreadId: ThreadId;
  leafThreadId: ThreadId;
  lineage: BranchedThreadRecord[];
}

const STORAGE_KEY = "t3code:branched-threads:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBranchedThreadKind(value: unknown): value is BranchedThreadKind {
  return value === "edit" || value === "retry";
}

function normalizeRecord(value: unknown): BranchedThreadRecord | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.threadId) ||
    !isNonEmptyString(value.parentThreadId) ||
    !isNonEmptyString(value.rootThreadId) ||
    !isNonEmptyString(value.anchorThreadId) ||
    !isNonEmptyString(value.sourceThreadId) ||
    !isNonEmptyString(value.sourceMessageId) ||
    !isNonEmptyString(value.variantGroupId) ||
    !isBranchedThreadKind(value.kind) ||
    !isNonEmptyString(value.createdAt)
  ) {
    return null;
  }

  return {
    threadId: value.threadId as ThreadId,
    parentThreadId: value.parentThreadId as ThreadId,
    rootThreadId: value.rootThreadId as ThreadId,
    anchorThreadId: value.anchorThreadId as ThreadId,
    sourceThreadId: value.sourceThreadId as ThreadId,
    sourceMessageId: value.sourceMessageId as MessageId,
    variantGroupId: value.variantGroupId,
    kind: value.kind,
    createdAt: value.createdAt,
  };
}

function writeRecords(records: ReadonlyArray<BranchedThreadRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore localStorage failures so chat flows keep working.
  }
}

export function buildVariantGroupId(kind: BranchedThreadKind, messageId: MessageId): string {
  return `${kind}:${messageId}`;
}

export function readBranchedThreadRecords(): BranchedThreadRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: BranchedThreadRecord[] = [];
    const seenThreadIds = new Set<string>();
    for (const entry of parsed) {
      const record = normalizeRecord(entry);
      if (!record || seenThreadIds.has(record.threadId)) continue;
      seenThreadIds.add(record.threadId);
      records.push(record);
    }
    return records.toSorted(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.threadId.localeCompare(right.threadId),
    );
  } catch {
    return [];
  }
}

export function upsertBranchedThreadRecord(record: BranchedThreadRecord): BranchedThreadRecord[] {
  const nextRecords = [
    ...readBranchedThreadRecords().filter((entry) => entry.threadId !== record.threadId),
    record,
  ].toSorted(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.threadId.localeCompare(right.threadId),
  );
  writeRecords(nextRecords);
  return nextRecords;
}

export function getBranchedThreadRecord(
  records: ReadonlyArray<BranchedThreadRecord>,
  threadId: ThreadId,
): BranchedThreadRecord | null {
  return records.find((record) => record.threadId === threadId) ?? null;
}

export function getBranchedThreadRootId(
  records: ReadonlyArray<BranchedThreadRecord>,
  threadId: ThreadId,
): ThreadId {
  return getBranchedThreadRecord(records, threadId)?.rootThreadId ?? threadId;
}

export function getBranchedThreadLineage(
  records: ReadonlyArray<BranchedThreadRecord>,
  leafThreadId: ThreadId,
): BranchedThreadLineageSelection {
  const lineage: BranchedThreadRecord[] = [];
  let cursor = getBranchedThreadRecord(records, leafThreadId);

  while (cursor) {
    lineage.push(cursor);
    cursor = getBranchedThreadRecord(records, cursor.parentThreadId);
  }

  lineage.reverse();
  const rootThreadId = lineage[0]?.rootThreadId ?? leafThreadId;

  return {
    rootThreadId,
    leafThreadId,
    lineage,
  };
}

export function getVariantThreadIdsForGroup(
  records: ReadonlyArray<BranchedThreadRecord>,
  groupId: string,
  anchorThreadId: ThreadId,
): ThreadId[] {
  const threadIds = new Set<ThreadId>([anchorThreadId]);
  for (const record of records) {
    if (record.variantGroupId !== groupId) continue;
    threadIds.add(record.threadId);
  }
  return Array.from(threadIds);
}

export function buildBranchedThreadTree(
  records: ReadonlyArray<BranchedThreadRecord>,
  rootThreadId: ThreadId,
): BranchedThreadTreeNode {
  const recordsByParent = new Map<ThreadId, BranchedThreadRecord[]>();
  for (const record of records) {
    if (record.rootThreadId !== rootThreadId) continue;
    const siblings = recordsByParent.get(record.parentThreadId) ?? [];
    siblings.push(record);
    recordsByParent.set(record.parentThreadId, siblings);
  }

  const buildNode = (
    threadId: ThreadId,
    kind: BranchedThreadKind | "root",
    createdAt: string,
    parentThreadId: ThreadId | null,
  ): BranchedThreadTreeNode => {
    const children = (recordsByParent.get(threadId) ?? [])
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.threadId.localeCompare(right.threadId),
      )
      .map((record) => buildNode(record.threadId, record.kind, record.createdAt, record.parentThreadId));

    return {
      threadId,
      parentThreadId,
      kind,
      createdAt,
      children,
    };
  };

  return buildNode(rootThreadId, "root", "", null);
}
