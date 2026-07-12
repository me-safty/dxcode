import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type WindowedOrchestrationThread,
} from "@t3tools/contracts";

import {
  applyWindowedThreadEvent,
  fromWindowSnapshot,
  mergeWindowHistoryPage,
} from "./windowedThread.ts";

const threadId = ThreadId.make("thread-1");
const messageId = MessageId.make("message-1");
const snapshot: WindowedOrchestrationThread = {
  syncVersion: 2,
  historyEpoch: 0,
  lastAppliedSequence: 10,
  head: {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    session: null,
    activeProposedPlan: null,
    pendingRequests: [],
    counts: { messages: 2, activities: 0 },
  },
  messages: [
    {
      id: messageId,
      role: "user",
      text: "boundary",
      turnId: null,
      streaming: false,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  activities: [],
  before: {
    message: { createdAt: "2026-01-02T00:00:00.000Z", messageId },
    activity: null,
  },
  hasOlderMessages: true,
  hasOlderActivities: false,
};

describe("windowed thread", () => {
  it("deduplicates the page boundary by id", () => {
    const thread = fromWindowSnapshot(snapshot);
    const merged = mergeWindowHistoryPage(thread, {
      historyEpoch: 0,
      messages: [
        {
          ...snapshot.messages[0]!,
          text: "boundary replacement",
        },
      ],
      activities: [],
      before: snapshot.before,
      hasOlderMessages: false,
      hasOlderActivities: false,
    });
    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]?.text).toBe("boundary replacement");
  });

  it("requests a tail resync on revert", () => {
    const event: OrchestrationEvent = {
      sequence: 11,
      eventId: EventId.make("event-1"),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: "2026-01-03T00:00:00.000Z",
      commandId: CommandId.make("command-1"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.reverted",
      payload: { threadId, turnCount: 0 },
    };
    expect(applyWindowedThreadEvent(fromWindowSnapshot(snapshot), event).kind).toBe("resync");
  });
});
