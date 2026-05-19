import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";

export function mergeContextAttachmentsById(input: {
  current: ReadonlyArray<T3WorkContextAttachment>;
  incoming: ReadonlyArray<T3WorkContextAttachment>;
  dismissedIds?: ReadonlySet<string>;
}): T3WorkContextAttachment[] {
  const dismissedIds = input.dismissedIds ?? new Set<string>();
  const incomingById = new Map(
    input.incoming
      .filter((attachment) => !dismissedIds.has(attachment.id))
      .map((attachment) => [attachment.id, attachment] as const),
  );
  const seen = new Set<string>();
  const next: T3WorkContextAttachment[] = [];

  for (const attachment of input.current) {
    if (dismissedIds.has(attachment.id)) {
      continue;
    }
    next.push(incomingById.get(attachment.id) ?? attachment);
    seen.add(attachment.id);
  }

  for (const attachment of input.incoming) {
    if (dismissedIds.has(attachment.id) || seen.has(attachment.id)) {
      continue;
    }
    next.push(attachment);
  }

  return next;
}
