import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { excludeOptimisticMessagesAlreadyRendered } from "./MessagesTimelineContainer";
import type { ChatMessage } from "../../types";

function createUserMessage(id: string): ChatMessage {
  return {
    id: MessageId.make(id),
    role: "user",
    text: id,
    createdAt: "2026-04-12T12:00:00.000Z",
    streaming: false,
  };
}

function createAssistantMessage(id: string): ChatMessage {
  return {
    id: MessageId.make(id),
    role: "assistant",
    text: id,
    createdAt: "2026-04-12T12:00:01.000Z",
    streaming: false,
  };
}

describe("excludeOptimisticMessagesAlreadyRendered", () => {
  it("drops optimistic user messages once the same id is already rendered by the server", () => {
    const optimisticUserMessages = [
      createUserMessage("optimistic-user"),
      createUserMessage("still-pending-user"),
    ];
    const renderedServerMessages = [
      createUserMessage("optimistic-user"),
      createAssistantMessage("settled-assistant"),
    ];

    expect(
      excludeOptimisticMessagesAlreadyRendered(optimisticUserMessages, renderedServerMessages),
    ).toEqual([optimisticUserMessages[1]]);
  });

  it("keeps optimistic user messages that are not yet present in server-rendered history", () => {
    const optimisticUserMessages = [createUserMessage("still-pending-user")];
    const renderedServerMessages = [createAssistantMessage("settled-assistant")];

    expect(
      excludeOptimisticMessagesAlreadyRendered(optimisticUserMessages, renderedServerMessages),
    ).toEqual(optimisticUserMessages);
  });
});
