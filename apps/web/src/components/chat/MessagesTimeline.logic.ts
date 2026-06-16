import * as Equal from "effect/Equal";
import { type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { type MessageId, type TurnId } from "@t3tools/contracts";

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: TimelineActivityEntry[];
      turnIds: ReadonlyArray<TurnId>;
      completionSummary: string | null;
      activeStartedAt: string | null;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
      completionSummary: string | null;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    };

export type TimelineActivityEntry =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      workEntry: WorkLogEntry;
    }
  | {
      kind: "assistant-message";
      id: string;
      createdAt: string;
      message: ChatMessage;
    };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  completionSummary?: string | null;
  completionSummaryTurnId?: TurnId | null;
  completionSummaryStartedAt?: string | null;
  completionSummaryCompletedAt?: string | null;
  isWorking: boolean;
  activeTurnInProgress?: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  let pendingWorkGroup: {
    id: string;
    createdAt: string;
    groupedEntries: TimelineActivityEntry[];
    turnIds: Set<TurnId>;
  } | null = null;
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);

  const appendWorkEntry = (id: string, createdAt: string, entry: WorkLogEntry) => {
    const activityEntry: TimelineActivityEntry = {
      kind: "work",
      id,
      createdAt,
      workEntry: entry,
    };
    if (pendingWorkGroup) {
      pendingWorkGroup.groupedEntries.push(activityEntry);
      if (entry.turnId) {
        pendingWorkGroup.turnIds.add(entry.turnId);
      }
      return;
    }
    pendingWorkGroup = {
      id,
      createdAt,
      groupedEntries: [activityEntry],
      turnIds: entry.turnId ? new Set([entry.turnId]) : new Set(),
    };
  };

  const appendAssistantActivityEntry = (id: string, createdAt: string, message: ChatMessage) => {
    const activityEntry: TimelineActivityEntry = {
      kind: "assistant-message",
      id,
      createdAt,
      message,
    };
    if (pendingWorkGroup) {
      pendingWorkGroup.groupedEntries.push(activityEntry);
      if (message.turnId) {
        pendingWorkGroup.turnIds.add(message.turnId);
      }
      return;
    }
    pendingWorkGroup = {
      id,
      createdAt,
      groupedEntries: [activityEntry],
      turnIds: message.turnId ? new Set([message.turnId]) : new Set(),
    };
  };

  const flushWorkGroup = (nextEntryId: string | null) => {
    if (!pendingWorkGroup) {
      return;
    }
    const hasVisibleEntries = pendingWorkGroup.groupedEntries.some(
      (entry) => entry.kind !== "work" || entry.workEntry.hidden !== true,
    );
    if (!hasVisibleEntries) {
      pendingWorkGroup = null;
      return;
    }
    nextRows.push({
      kind: "work",
      id: pendingWorkGroup.id,
      createdAt: pendingWorkGroup.createdAt,
      groupedEntries: pendingWorkGroup.groupedEntries,
      turnIds: [...pendingWorkGroup.turnIds],
      completionSummary: resolveWorkGroupCompletionSummary({
        nextEntryId,
        completionDividerBeforeEntryId: input.completionDividerBeforeEntryId,
        completionSummary: input.completionSummary ?? null,
        completionSummaryTurnId: input.completionSummaryTurnId ?? null,
        completionSummaryStartedAt: input.completionSummaryStartedAt ?? null,
        completionSummaryCompletedAt: input.completionSummaryCompletedAt ?? null,
        turnIds: pendingWorkGroup.turnIds,
        groupedEntries: pendingWorkGroup.groupedEntries,
      }),
      activeStartedAt: null,
    });
    pendingWorkGroup = null;
  };

  const flushActiveWorkGroup = () => {
    if (!pendingWorkGroup) {
      nextRows.push({
        kind: "work",
        id: "working-indicator-row",
        createdAt: input.activeTurnStartedAt ?? new Date(0).toISOString(),
        groupedEntries: [],
        turnIds: input.activeTurnId ? [input.activeTurnId] : [],
        completionSummary: null,
        activeStartedAt: input.activeTurnStartedAt ?? "",
      });
      return;
    }
    nextRows.push({
      kind: "work",
      id: pendingWorkGroup.id,
      createdAt: pendingWorkGroup.createdAt,
      groupedEntries: pendingWorkGroup.groupedEntries,
      turnIds: [...pendingWorkGroup.turnIds],
      completionSummary: null,
      activeStartedAt: input.activeTurnStartedAt ?? "",
    });
    pendingWorkGroup = null;
  };

  const isActiveTurnAssistantMessage = (message: ChatMessage) => {
    if (message.role !== "assistant" || input.activeTurnInProgress !== true) {
      return false;
    }
    if (input.activeTurnId && message.turnId === input.activeTurnId) {
      return true;
    }
    if (!input.activeTurnStartedAt) {
      return false;
    }
    const messageAt = Date.parse(message.createdAt);
    const activeStartedAt = Date.parse(input.activeTurnStartedAt);
    return (
      !Number.isNaN(messageAt) && !Number.isNaN(activeStartedAt) && messageAt >= activeStartedAt
    );
  };

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      appendWorkEntry(timelineEntry.id, timelineEntry.createdAt, timelineEntry.entry);
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      flushWorkGroup(timelineEntry.id);
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    if (
      isActiveTurnAssistantMessage(timelineEntry.message) ||
      (timelineEntry.message.role === "assistant" &&
        !terminalAssistantMessageIds.has(timelineEntry.message.id))
    ) {
      appendAssistantActivityEntry(
        `assistant-work:${timelineEntry.id}`,
        timelineEntry.createdAt,
        timelineEntry.message,
      );
      continue;
    }

    flushWorkGroup(timelineEntry.id);

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      input.activeTurnInProgress === true &&
      input.activeTurnId != null &&
      timelineEntry.message.turnId === input.activeTurnId;

    const showCompletionDivider =
      timelineEntry.message.role === "assistant" &&
      input.completionDividerBeforeEntryId === timelineEntry.id;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider,
      completionSummary: showCompletionDivider ? (input.completionSummary ?? null) : null,
      showAssistantCopyButton:
        timelineEntry.message.role === "assistant" &&
        terminalAssistantMessageIds.has(timelineEntry.message.id),
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
    flushActiveWorkGroup();
  } else {
    flushWorkGroup(null);
  }

  return nextRows;
}

function resolveWorkGroupCompletionSummary(input: {
  nextEntryId: string | null;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  completionSummaryTurnId: TurnId | null;
  completionSummaryStartedAt: string | null;
  completionSummaryCompletedAt: string | null;
  turnIds: ReadonlySet<TurnId>;
  groupedEntries: ReadonlyArray<TimelineActivityEntry>;
}): string | null {
  if (!input.completionSummary) {
    return null;
  }

  if (input.completionSummaryTurnId && input.turnIds.has(input.completionSummaryTurnId)) {
    return input.completionSummary;
  }

  if (
    groupIntersectsTimeWindow(
      input.groupedEntries,
      input.completionSummaryStartedAt,
      input.completionSummaryCompletedAt,
    )
  ) {
    return input.completionSummary;
  }

  return input.nextEntryId === input.completionDividerBeforeEntryId
    ? input.completionSummary
    : null;
}

function groupIntersectsTimeWindow(
  groupedEntries: ReadonlyArray<Pick<TimelineActivityEntry, "createdAt">>,
  startedAt: string | null,
  completedAt: string | null,
): boolean {
  if (!startedAt || !completedAt) {
    return false;
  }

  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);
  if (Number.isNaN(startedAtMs) || Number.isNaN(completedAtMs) || completedAtMs < startedAtMs) {
    return false;
  }

  return groupedEntries.some((entry) => {
    const createdAtMs = Date.parse(entry.createdAt);
    return !Number.isNaN(createdAtMs) && createdAtMs >= startedAtMs && createdAtMs <= completedAtMs;
  });
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return (
        a.completionSummary === (b as typeof a).completionSummary &&
        a.activeStartedAt === (b as typeof a).activeStartedAt &&
        Equal.equals(a.turnIds, (b as typeof a).turnIds) &&
        Equal.equals(a.groupedEntries, (b as typeof a).groupedEntries)
      );

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.completionSummary === bm.completionSummary &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
