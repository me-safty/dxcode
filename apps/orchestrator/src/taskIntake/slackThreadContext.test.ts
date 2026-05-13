import { Message, parseMarkdown, type Thread } from "chat";
import { describe, expect, it } from "vitest";

import { collectSlackThreadContext } from "./slackThreadContext.ts";

function message(input: {
  readonly id: string;
  readonly text: string;
  readonly dateSent: string;
  readonly author?: string;
  readonly isBot?: boolean;
}) {
  return new Message({
    id: input.id,
    threadId: "slack:C1:1000.000",
    text: input.text,
    formatted: parseMarkdown(input.text),
    raw: {},
    author: {
      userId: input.author ?? "U1",
      userName: input.author ?? "vivek",
      fullName: input.author ?? "Vivek",
      isBot: input.isBot ?? false,
      isMe: false,
    },
    metadata: {
      dateSent: new Date(input.dateSent),
      edited: false,
    },
    attachments: [],
  });
}

function threadWith(messages: readonly Message[]) {
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        for (const item of messages) {
          yield item;
        }
      },
    },
  } as unknown as Thread;
}

describe("collectSlackThreadContext", () => {
  it("collects prior non-bot messages in chronological order", async () => {
    const trigger = message({
      id: "3",
      text: "@Vevin summarize this",
      dateSent: "2026-05-13T12:02:00.000Z",
    });
    const context = await collectSlackThreadContext(
      threadWith([
        trigger,
        message({
          id: "2",
          text: "Second point",
          dateSent: "2026-05-13T12:01:00.000Z",
          author: "Asha",
        }),
        message({
          id: "1",
          text: "First point",
          dateSent: "2026-05-13T12:00:00.000Z",
          author: "Vivek",
        }),
      ]),
      trigger,
    );

    expect(context).toBe("Vivek: First point\n\nAsha: Second point");
  });

  it("excludes the trigger message and bot messages", async () => {
    const trigger = message({
      id: "2",
      text: "@Vevin help",
      dateSent: "2026-05-13T12:01:00.000Z",
    });
    const context = await collectSlackThreadContext(
      threadWith([
        trigger,
        message({
          id: "bot",
          text: "status card",
          dateSent: "2026-05-13T12:00:30.000Z",
          isBot: true,
        }),
      ]),
      trigger,
    );

    expect(context).toBeUndefined();
  });
});
