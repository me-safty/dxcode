import {
  CheckpointRef,
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveWebPushPayloadForEvent } from "./WebPushNotificationReactor.ts";

const now = "2026-01-01T00:00:00.000Z";

function makeTurnDiffCompletedEvent(
  status: "ready" | "missing" | "error",
): Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }> {
  const threadId = ThreadId.make("thread-1");
  const turnId = TurnId.make("turn-1");

  return {
    sequence: 1,
    eventId: EventId.make(`event-turn-diff-${status}`),
    type: "thread.turn-diff-completed",
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: now,
    commandId: CommandId.make(`cmd-turn-diff-${status}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      turnId,
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make(`checkpoint-${status}`),
      status,
      files: [],
      assistantMessageId: MessageId.make("assistant-1"),
      completedAt: now,
    },
  };
}

function makeTurnCompletedEvent(
  state: "completed" | "failed" = "completed",
): Extract<ProviderRuntimeEvent, { type: "turn.completed" }> {
  return {
    eventId: EventId.make(`event-turn-completed-${state}`),
    type: "turn.completed",
    provider: ProviderDriverKind.make("codex"),
    threadId: ThreadId.make("thread-1"),
    turnId: TurnId.make("turn-1"),
    createdAt: now,
    payload: {
      state,
    },
  };
}

describe("deriveWebPushPayloadForEvent", () => {
  it("does not send a completion notification for placeholder turn diffs", () => {
    const payload = deriveWebPushPayloadForEvent({
      event: makeTurnDiffCompletedEvent("missing"),
      environmentId: EnvironmentId.make("environment-local"),
      threadTitle: "Thread still running",
    });

    expect(payload).toBeNull();
  });

  it("does not send a completion notification for finalized turn diffs", () => {
    const payload = deriveWebPushPayloadForEvent({
      event: makeTurnDiffCompletedEvent("ready"),
      environmentId: EnvironmentId.make("environment-local"),
      threadTitle: "Finished thread",
    });

    expect(payload).toBeNull();
  });

  it("sends a completion notification for runtime turn completion", () => {
    const payload = deriveWebPushPayloadForEvent({
      event: makeTurnCompletedEvent(),
      environmentId: EnvironmentId.make("environment-local"),
      threadTitle: "Finished thread",
    });

    expect(payload).toEqual({
      title: "Agent turn completed",
      body: "Finished thread",
      url: "/environment-local/thread-1",
      tag: "thread:thread-1:turn:turn-1",
    });
  });
});
