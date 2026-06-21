type AssistantSegmentMessage = {
  readonly role: string;
  readonly streaming: boolean;
  readonly turnId: string | null;
};

export type AssistantSegmentThreadMessage = AssistantSegmentMessage & {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attachments?: ReadonlyArray<unknown> | undefined;
};

export function assistantSegmentTurnChanged(
  existing: Pick<AssistantSegmentMessage, "turnId" | "streaming"> | undefined,
  incoming: Pick<AssistantSegmentMessage, "turnId">,
): boolean {
  if (existing === undefined || incoming.turnId == null) {
    return false;
  }
  if (existing.turnId != null) {
    return existing.turnId !== incoming.turnId;
  }
  // In-flight rebound: keep appending until the segment settles. Completed replay
  // rows without a turnId are rebounding to a new live turn and should reset.
  return !existing.streaming;
}

/**
 * Grok can deliver trailing session/update chunks after a turn has already
 * settled. Ignore cross-turn late streaming deltas so completed assistant rows
 * keep a stable timeline anchor for ordering, but keep appending when the
 * provider is still finishing the same turn (for example after prompt_complete
 * races ahead of trailing session/update chunks).
 */
export function isLateStreamingOnCompletedAssistant(input: {
  readonly existing: AssistantSegmentMessage | undefined;
  readonly incoming: AssistantSegmentMessage;
  readonly turnStillActive?: boolean;
}): boolean {
  if (input.incoming.role !== "assistant" || !input.incoming.streaming) {
    return false;
  }
  const existing = input.existing;
  if (existing === undefined || existing.role !== "assistant" || existing.streaming) {
    return false;
  }
  // Provider ingestion can emit the first rebound delta before turnId is known.
  if (input.incoming.turnId === null) {
    return false;
  }
  if (input.turnStillActive) {
    return false;
  }
  if (
    input.incoming.turnId !== null &&
    existing.turnId !== null &&
    existing.turnId === input.incoming.turnId
  ) {
    return false;
  }
  return !assistantSegmentTurnChanged(existing, input.incoming);
}

/**
 * Grok can deliver a stale assistant segment for an older turn after the live
 * provider message id has already advanced to a newer turn.
 */
export function isLateAssistantSegmentFromPriorTurn(input: {
  readonly existing: AssistantSegmentMessage | undefined;
  readonly incoming: AssistantSegmentMessage;
  readonly providerMessageId?: string;
  readonly archivedTurnIds?: ReadonlySet<string | null>;
  readonly turnStillActive?: boolean;
}): boolean {
  if (input.incoming.role !== "assistant" || input.existing?.role !== "assistant") {
    return false;
  }
  if (input.incoming.turnId === null) {
    const archivedTurnIds = input.archivedTurnIds;
    return (
      input.incoming.streaming &&
      archivedTurnIds !== undefined &&
      archivedTurnIds.size > 0 &&
      input.turnStillActive !== true
    );
  }
  if (input.existing.turnId === input.incoming.turnId) {
    return false;
  }
  const providerMessageId = input.providerMessageId;
  if (providerMessageId === undefined) {
    return false;
  }
  const archivedTurnIds = input.archivedTurnIds;
  if (archivedTurnIds !== undefined) {
    return archivedTurnIds.has(input.incoming.turnId);
  }
  return false;
}

export function assistantSegmentBelongsToActiveTurn(input: {
  readonly activeTurnId: string | null | undefined;
  readonly existingTurnId: string | null | undefined;
  readonly incomingTurnId: string | null;
}): boolean {
  const activeTurnId = input.activeTurnId ?? null;
  if (activeTurnId === null) {
    return false;
  }
  if (input.incomingTurnId !== null) {
    return input.incomingTurnId === activeTurnId;
  }
  return (
    input.existingTurnId === undefined ||
    input.existingTurnId === null ||
    input.existingTurnId === activeTurnId
  );
}

export function archivedAssistantSegmentTurnIds(
  messages: ReadonlyArray<{ readonly id: string; readonly turnId: string | null }>,
  providerMessageId: string,
): ReadonlySet<string | null> {
  const prefix = `${providerMessageId}@turn:`;
  const archivedTurnIds = new Set<string | null>();
  for (const message of messages) {
    if (message.id === undefined || !message.id.startsWith(prefix)) {
      continue;
    }
    archivedTurnIds.add(message.turnId);
  }
  return archivedTurnIds;
}

export function assistantSegmentRebindArchives(
  existing: AssistantSegmentMessage | undefined,
  incoming: Pick<AssistantSegmentMessage, "streaming" | "turnId">,
  options?: {
    readonly activeTurnId?: string | null;
    readonly turnStillActive?: boolean;
  },
): boolean {
  const existingTurnStillActive =
    options?.turnStillActive === true &&
    options.activeTurnId != null &&
    existing?.turnId === options.activeTurnId;
  return (
    existing !== undefined &&
    existing.role === "assistant" &&
    !existing.streaming &&
    existing.turnId !== null &&
    incoming.streaming &&
    incoming.turnId === null &&
    !existingTurnStillActive
  );
}

export function archivedAssistantSegmentMessageId(
  messageId: string,
  turnId: string | null,
  occurrence?: string,
): string {
  if (turnId !== null) {
    return `${messageId}@turn:${turnId}`;
  }
  return `${messageId}@turn:replay${occurrence === undefined ? "" : `:${occurrence}`}`;
}

export function assistantSegmentStreamingTextResets(
  existing: AssistantSegmentMessage | undefined,
  incoming: Pick<AssistantSegmentMessage, "streaming" | "turnId">,
  options?: {
    readonly activeTurnId?: string | null;
    readonly turnStillActive?: boolean;
  },
): boolean {
  if (!incoming.streaming || existing?.role !== "assistant") {
    return false;
  }
  if (assistantSegmentTurnChanged(existing, incoming)) {
    return true;
  }
  // Completed replay rows with a known turn keep stale text until the first
  // rebound chunk arrives with turnId still unknown. Null-to-null continuation
  // within the same live segment must keep appending.
  const existingTurnStillActive =
    options?.turnStillActive === true &&
    options.activeTurnId != null &&
    existing.turnId === options.activeTurnId;
  return (
    existing !== undefined &&
    !existing.streaming &&
    existing.turnId !== null &&
    incoming.turnId === null &&
    !existingTurnStillActive
  );
}

export function assistantSegmentTimelineAnchorResets(
  existing: AssistantSegmentMessage | undefined,
  incoming: Pick<AssistantSegmentMessage, "streaming" | "turnId">,
  options?: {
    readonly activeTurnId?: string | null;
    readonly turnStillActive?: boolean;
  },
): boolean {
  return (
    assistantSegmentTurnChanged(existing, incoming) ||
    assistantSegmentStreamingTextResets(existing, incoming, options)
  );
}

export function resolveAssistantSegmentText(
  existing: Pick<AssistantSegmentThreadMessage, "text"> | undefined,
  incoming: Pick<AssistantSegmentThreadMessage, "text" | "streaming">,
  textResets: boolean,
): string {
  if (incoming.streaming) {
    return textResets ? incoming.text : `${existing?.text ?? ""}${incoming.text}`;
  }
  if (incoming.text.length === 0 && !textResets) {
    return existing?.text ?? incoming.text;
  }
  return incoming.text;
}

export function resolveAssistantSegmentAttachments<T>(
  existingAttachments: ReadonlyArray<T> | undefined,
  incoming: { readonly attachments?: ReadonlyArray<T> | undefined },
  turnChanged: boolean,
): ReadonlyArray<T> | undefined {
  if (incoming.attachments !== undefined) {
    return incoming.attachments;
  }
  if (turnChanged) {
    return undefined;
  }
  return existingAttachments;
}

export function repointCheckpointsForArchivedAssistantSegment<
  T extends { readonly turnId: string; readonly assistantMessageId: string | null },
>(
  checkpoints: ReadonlyArray<T>,
  providerMessageId: string,
  archivedMessageId: string | null,
  archivedTurnId: string,
): readonly T[] {
  return checkpoints.map((entry) =>
    entry.turnId === archivedTurnId && entry.assistantMessageId === providerMessageId
      ? { ...entry, assistantMessageId: archivedMessageId as T["assistantMessageId"] }
      : entry,
  );
}

export function repointLatestTurnForArchivedAssistantSegment<
  T extends { readonly turnId: string; readonly assistantMessageId: string | null },
>(
  latestTurn: T | null,
  repoint: {
    readonly providerMessageId: string;
    readonly archivedMessageId: string | null;
    readonly archivedTurnId: string;
  },
): T | null {
  if (
    latestTurn === null ||
    latestTurn.turnId !== repoint.archivedTurnId ||
    latestTurn.assistantMessageId !== repoint.providerMessageId
  ) {
    return latestTurn;
  }
  return {
    ...latestTurn,
    assistantMessageId: repoint.archivedMessageId as T["assistantMessageId"],
  };
}

export function applyAssistantSegmentMessageUpdate<T extends AssistantSegmentThreadMessage>(
  messages: ReadonlyArray<T>,
  incoming: T,
  options?: {
    readonly activeTurnId?: string | null;
    readonly turnStillActive?: boolean;
  },
): {
  readonly messages: readonly T[];
  readonly checkpointsToRepoint:
    | {
        readonly providerMessageId: string;
        readonly archivedMessageId: string;
        readonly archivedTurnId: string;
      }
    | undefined;
} {
  const existingMessage = messages.find((entry) => entry.id === incoming.id);
  const archivedTurnIds = archivedAssistantSegmentTurnIds(messages, incoming.id);
  if (
    isLateAssistantSegmentFromPriorTurn({
      existing: existingMessage,
      incoming,
      providerMessageId: incoming.id,
      archivedTurnIds,
      turnStillActive: options?.turnStillActive === true,
    }) ||
    isLateStreamingOnCompletedAssistant({
      existing: existingMessage,
      incoming,
      turnStillActive: options?.turnStillActive === true,
    })
  ) {
    return { messages, checkpointsToRepoint: undefined };
  }

  const turnChanged = assistantSegmentTurnChanged(existingMessage, incoming);
  const textResets = assistantSegmentStreamingTextResets(existingMessage, incoming, {
    activeTurnId: options?.activeTurnId ?? null,
    turnStillActive: options?.turnStillActive === true,
  });
  const rebindArchives = assistantSegmentRebindArchives(existingMessage, incoming, {
    activeTurnId: options?.activeTurnId ?? null,
    turnStillActive: options?.turnStillActive === true,
  });
  const shouldArchive = turnChanged || rebindArchives;
  const timelineAnchorResets = assistantSegmentTimelineAnchorResets(existingMessage, incoming, {
    activeTurnId: options?.activeTurnId ?? null,
    turnStillActive: options?.turnStillActive === true,
  });
  const nextText = resolveAssistantSegmentText(existingMessage, incoming, textResets);
  const resolvedAttachments = resolveAssistantSegmentAttachments(
    existingMessage?.attachments,
    incoming,
    shouldArchive,
  );
  const attachmentFields =
    resolvedAttachments !== undefined
      ? { attachments: resolvedAttachments }
      : shouldArchive
        ? { attachments: undefined }
        : {};
  const liveMessage: T = {
    ...(existingMessage ?? incoming),
    ...incoming,
    text: nextText,
    createdAt: timelineAnchorResets
      ? incoming.createdAt
      : (existingMessage?.createdAt ?? incoming.createdAt),
    ...attachmentFields,
  };

  if (existingMessage === undefined) {
    return { messages: [...messages, liveMessage], checkpointsToRepoint: undefined };
  }

  const existingIndex = messages.findIndex((entry) => entry.id === incoming.id);

  if (shouldArchive) {
    const archivedTurnId = existingMessage.turnId;
    const archivedMessage: T = {
      ...existingMessage,
      id: archivedAssistantSegmentMessageId(
        incoming.id,
        archivedTurnId,
        existingMessage.createdAt,
      ) as T["id"],
      streaming: false,
    };
    return {
      messages: [
        ...messages.slice(0, existingIndex),
        archivedMessage,
        ...messages.slice(existingIndex + 1),
        liveMessage,
      ],
      checkpointsToRepoint:
        archivedTurnId !== null
          ? {
              providerMessageId: incoming.id,
              archivedMessageId: archivedMessage.id,
              archivedTurnId,
            }
          : undefined,
    };
  }

  return {
    messages: [
      ...messages.slice(0, existingIndex),
      liveMessage,
      ...messages.slice(existingIndex + 1),
    ],
    checkpointsToRepoint: undefined,
  };
}
