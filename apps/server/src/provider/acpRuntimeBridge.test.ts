import { EventId, RuntimeItemId, ThreadId, TurnId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeAcpRuntimeBridge } from "./acpRuntimeBridge.ts";

describe("acpRuntimeBridge", () => {
  it("preserves whitespace in assistant text deltas", async () => {
    const events: Array<unknown> = [];
    let stampCount = 0;
    let itemCount = 0;
    const bridge = makeAcpRuntimeBridge({
      provider: "droid",
      logLabel: "[test]",
      makeStamp: () =>
        Effect.succeed({
          eventId: EventId.makeUnsafe(`evt-${++stampCount}`),
          createdAt: "2026-03-30T00:00:00.000Z",
        }),
      nextItemId: Effect.sync(() => RuntimeItemId.makeUnsafe(`item-${++itemCount}`)),
      offerEvent: (event) => Effect.sync(() => void events.push(event)),
    });

    const session = {
      threadId: ThreadId.makeUnsafe("thread-acp-spaces"),
      activeTurnId: TurnId.makeUnsafe("turn-acp-spaces"),
    };

    await Effect.runPromise(
      bridge.handleSessionUpdate(session, {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Here" },
        },
      }),
    );
    await Effect.runPromise(
      bridge.handleSessionUpdate(session, {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "'s what the subagent found" },
        },
      }),
    );

    const deltas = events.flatMap((event) =>
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "content.delta" &&
      "payload" in event &&
      typeof event.payload === "object" &&
      event.payload !== null &&
      "delta" in event.payload
        ? [event.payload.delta]
        : [],
    );

    expect(deltas).toEqual(["Here", "'s what the subagent found"]);
    expect(deltas.join("")).toBe("Here's what the subagent found");
  });

  it("preserves whitespace when summarizing tool call output", async () => {
    const events: Array<unknown> = [];
    let stampCount = 0;
    let itemCount = 0;
    const bridge = makeAcpRuntimeBridge({
      provider: "droid",
      logLabel: "[test]",
      makeStamp: () =>
        Effect.succeed({
          eventId: EventId.makeUnsafe(`evt-${++stampCount}`),
          createdAt: "2026-03-30T00:00:00.000Z",
        }),
      nextItemId: Effect.sync(() => RuntimeItemId.makeUnsafe(`item-${++itemCount}`)),
      offerEvent: (event) => Effect.sync(() => void events.push(event)),
    });

    const session = {
      threadId: ThreadId.makeUnsafe("thread-acp-tool-spaces"),
      activeTurnId: TurnId.makeUnsafe("turn-acp-tool-spaces"),
    };

    await Effect.runPromise(
      bridge.handleSessionUpdate(session, {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-call-1",
          title: "Task",
          rawInput: { subagent_type: "explore", description: "Read files" },
        },
      }),
    );
    await Effect.runPromise(
      bridge.handleSessionUpdate(session, {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-call-1",
          content: [
            { text: "Here's" },
            { text: " what the subagent found:" },
            { text: "\n- package.json: The t3 package" },
          ],
        },
      }),
    );

    const updatedEvent = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "item.updated",
    ) as { payload: { detail?: string } } | undefined;

    expect(updatedEvent?.payload.detail).toBe(
      "Here's what the subagent found:\n- package.json: The t3 package",
    );
  });
});
