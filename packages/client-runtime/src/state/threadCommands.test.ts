import { describe, expect, it } from "vite-plus/test";

import { threadCommandConcurrencyKey } from "./threadCommands.ts";

describe("thread command concurrency", () => {
  const input = {
    environmentId: "environment-1",
    input: { threadId: "thread-1" },
  };

  it("keeps control commands off the mutation lane", () => {
    expect(threadCommandConcurrencyKey("control", input)).not.toBe(
      threadCommandConcurrencyKey("mutation", input),
    );
  });

  it("serializes repeated control commands for the same thread", () => {
    expect(threadCommandConcurrencyKey("control", input)).toBe(
      threadCommandConcurrencyKey("control", input),
    );
  });
});
