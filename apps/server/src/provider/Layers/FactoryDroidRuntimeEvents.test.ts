import { assert, it } from "@effect/vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";

import { mapFactoryDroidCreateMessage } from "./FactoryDroidRuntimeEvents.ts";

const threadId = ThreadId.makeUnsafe("thread-1");
const turnId = TurnId.makeUnsafe("turn-1");

it("uses create_message text blocks as a fallback when no assistant delta was streamed", () => {
  const result = mapFactoryDroidCreateMessage({
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Draft answer" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Write",
          input: { path: "src/example.ts" },
        },
      ],
    },
    sawAssistantTextDelta: false,
    threadId,
    turnId,
  });

  const event = result.events[0]!;

  assert.equal(result.fallbackText, "Draft answer");
  assert.equal(result.events.length, 1);
  assert.equal(event.provider, "factoryDroid");
  assert.equal(event.threadId, threadId);
  assert.equal(event.type, "item.started");
  assert.equal(event.turnId, turnId);
  assert.equal(event.itemId, "tool-1");
  assert.deepEqual(event.payload, {
    itemType: "file_change",
    status: "inProgress",
    title: "File change: Write",
    detail: "src/example.ts",
  });
});

it("does not duplicate create_message text when assistant deltas were already streamed", () => {
  const result = mapFactoryDroidCreateMessage({
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Draft answer" }],
    },
    sawAssistantTextDelta: true,
    threadId,
    turnId,
  });

  assert.equal(result.fallbackText, "");
  assert.deepEqual(result.events, []);
});
