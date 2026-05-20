import { describe, expect, it } from "vitest";

import { assistantMessageRelayPhase, taskAssistantMessageReplyEventKey } from "./taskEvents.ts";

describe("task assistant message reply event keys", () => {
  it("keeps first and final relay claims distinct when they share a T3 message id", () => {
    const base = {
      workSessionId: "work-session-1",
      t3MessageId: "assistant-message-1",
      linkId: "slack-link-1",
    };

    expect(
      taskAssistantMessageReplyEventKey({
        ...base,
        sourceEventId: "event-1:assistant-first",
      }),
    ).not.toBe(
      taskAssistantMessageReplyEventKey({
        ...base,
        sourceEventId: "event-2:assistant-final",
      }),
    );
  });

  it("classifies first and final relay source events explicitly", () => {
    expect(assistantMessageRelayPhase("event-1:assistant-first")).toBe("first");
    expect(assistantMessageRelayPhase("event-2:assistant-final")).toBe("final");
    expect(assistantMessageRelayPhase("event-3")).toBe("unknown");
  });
});
