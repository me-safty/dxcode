import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";

export function buildKickoffQueueKey(projectId: string, ticketId: string): string {
  return `${projectId}:${ticketId}`;
}

export function hasQueuedAttachmentDuplicate<T extends { attachment: T3WorkContextAttachment }>(
  list: ReadonlyArray<T>,
  attachment: T3WorkContextAttachment,
): boolean {
  if (!attachment.dedupeKey) {
    return false;
  }
  return list.some((item) => item.attachment.dedupeKey === attachment.dedupeKey);
}

export function hasThreadAttachmentDuplicate(
  list: ReadonlyArray<T3WorkContextAttachment>,
  attachment: T3WorkContextAttachment,
): boolean {
  if (!attachment.dedupeKey) {
    return false;
  }
  return list.some((item) => item.dedupeKey === attachment.dedupeKey);
}

export function replaceQueuedAttachment<T extends { attachment: T3WorkContextAttachment }>(input: {
  list: ReadonlyArray<T>;
  attachmentId: string;
  buildReplacement: (item: T) => T;
}): { changed: boolean; items: T[] } {
  let changed = false;
  const items = input.list.map((item) => {
    if (item.attachment.id !== input.attachmentId) {
      return item;
    }
    changed = true;
    return input.buildReplacement(item);
  });
  return {
    changed,
    items,
  };
}

export function replaceThreadAttachmentList(input: {
  list: ReadonlyArray<T3WorkContextAttachment>;
  attachmentId: string;
  attachment: T3WorkContextAttachment;
}): { changed: boolean; items: T3WorkContextAttachment[] } {
  let changed = false;
  const items = input.list.map((candidate) => {
    if (candidate.id !== input.attachmentId) {
      return candidate;
    }
    changed = true;
    return input.attachment;
  });
  return {
    changed,
    items,
  };
}

export function removeThreadAttachmentList(
  list: ReadonlyArray<T3WorkContextAttachment>,
  attachmentId: string,
): T3WorkContextAttachment[] {
  return list.filter((attachment) => attachment.id !== attachmentId);
}

export function deleteRecordEntry<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
