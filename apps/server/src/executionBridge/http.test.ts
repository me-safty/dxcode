import { EventId, MessageId, ThreadId, TurnId, type OrchestrationEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { collectCompletedAssistantMessage } from "./http.ts";

function assistantMessageEvent(input: {
  readonly eventId: string;
  readonly messageId: string;
  readonly text: string;
  readonly streaming: boolean;
  readonly turnId?: string;
}): Extract<OrchestrationEvent, { type: "thread.message-sent" }> {
  const occurredAt = "2026-05-12T22:58:30.000Z";
  return {
    sequence: 1,
    eventId: EventId.make(input.eventId),
    type: "thread.message-sent",
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make(input.messageId),
      role: "assistant",
      text: input.text,
      turnId: input.turnId === undefined ? null : TurnId.make(input.turnId),
      streaming: input.streaming,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  };
}

describe("execution bridge assistant message relay", () => {
  it("waits for the provider-agnostic non-streaming completion event before relaying", () => {
    const cache = new Map();

    expect(
      collectCompletedAssistantMessage({
        cache,
        event: assistantMessageEvent({
          eventId: "event-1",
          messageId: "message-1",
          text: "Let me explore the repository",
          streaming: true,
          turnId: "turn-1",
        }),
      }),
    ).toBeUndefined();

    expect(
      collectCompletedAssistantMessage({
        cache,
        event: assistantMessageEvent({
          eventId: "event-2",
          messageId: "message-1",
          text: "",
          streaming: false,
          turnId: "turn-1",
        }),
      }),
    ).toBe("Let me explore the repository");
  });

  it("relays multiple completed assistant messages from the same turn independently", () => {
    const cache = new Map();

    collectCompletedAssistantMessage({
      cache,
      event: assistantMessageEvent({
        eventId: "event-1",
        messageId: "message-1",
        text: "First message",
        streaming: true,
        turnId: "turn-1",
      }),
    });
    const first = collectCompletedAssistantMessage({
      cache,
      event: assistantMessageEvent({
        eventId: "event-2",
        messageId: "message-1",
        text: "",
        streaming: false,
        turnId: "turn-1",
      }),
    });

    collectCompletedAssistantMessage({
      cache,
      event: assistantMessageEvent({
        eventId: "event-3",
        messageId: "message-2",
        text: "Final answer",
        streaming: true,
        turnId: "turn-1",
      }),
    });
    const second = collectCompletedAssistantMessage({
      cache,
      event: assistantMessageEvent({
        eventId: "event-4",
        messageId: "message-2",
        text: "",
        streaming: false,
        turnId: "turn-1",
      }),
    });

    expect(first).toBe("First message");
    expect(second).toBe("Final answer");
  });
});
