import { describe, expect, it } from "vitest";

import { shouldRelayFinalAssistantMessage } from "./Reactor.ts";

describe("external intake assistant relay boundaries", () => {
  it("does not relay a final message when the turn only produced the already relayed first message", () => {
    expect(
      shouldRelayFinalAssistantMessage({
        firstRelay: {
          messageId: "assistant-message-1",
          text: "Done.",
        },
        finalResponse: {
          messageId: "assistant-message-1",
          text: "Done.",
        },
      }),
    ).toBe(false);
  });

  it("relays a final message when it is a distinct assistant message", () => {
    expect(
      shouldRelayFinalAssistantMessage({
        firstRelay: {
          messageId: "assistant-message-1",
          text: "Starting.",
        },
        finalResponse: {
          messageId: "assistant-message-2",
          text: "Done.",
        },
      }),
    ).toBe(true);
  });

  it("relays a final message when no first message was relayed", () => {
    expect(
      shouldRelayFinalAssistantMessage({
        finalResponse: {
          messageId: "assistant-message-1",
          text: "Done.",
        },
      }),
    ).toBe(true);
  });

  it("does not relay a final message twice for the same turn", () => {
    expect(
      shouldRelayFinalAssistantMessage({
        firstRelay: {
          messageId: "assistant-message-1",
          text: "Starting.",
        },
        finalRelay: {
          messageId: "assistant-message-2",
          text: "Done.",
        },
        finalResponse: {
          messageId: "assistant-message-2",
          text: "Done.",
        },
      }),
    ).toBe(false);
  });

  it("does not relay when there is no settled final message", () => {
    expect(
      shouldRelayFinalAssistantMessage({
        firstRelay: {
          messageId: "assistant-message-1",
          text: "Starting.",
        },
      }),
    ).toBe(false);
  });
});
