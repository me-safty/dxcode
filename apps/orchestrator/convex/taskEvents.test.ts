import { describe, expect, it } from "vitest";

import { taskAssistantMessageReplyEventKey } from "./taskEvents.ts";

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
});
