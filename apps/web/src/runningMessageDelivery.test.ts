import { describe, expect, it } from "vite-plus/test";

import {
  resolveRunningMessageBehavior,
  replaceQueuedMessage,
  shouldShowRunningStopAction,
  takeNextQueuedMessageForThread,
} from "./runningMessageDelivery";

describe("resolveRunningMessageBehavior", () => {
  it("uses the configured behavior for a normal submission", () => {
    expect(resolveRunningMessageBehavior({ defaultBehavior: "queue", steerShortcut: false })).toBe(
      "queue",
    );
    expect(resolveRunningMessageBehavior({ defaultBehavior: "steer", steerShortcut: false })).toBe(
      "steer",
    );
  });

  it("always steers for the modifier shortcut", () => {
    expect(resolveRunningMessageBehavior({ defaultBehavior: "queue", steerShortcut: true })).toBe(
      "steer",
    );
  });
});

describe("shouldShowRunningStopAction", () => {
  it("changes Stop to Send once the running composer has content", () => {
    expect(shouldShowRunningStopAction({ running: true, hasSendableContent: false })).toBe(true);
    expect(shouldShowRunningStopAction({ running: true, hasSendableContent: true })).toBe(false);
  });
});

describe("takeNextQueuedMessageForThread", () => {
  it("drains only the first message for the active thread", () => {
    const result = takeNextQueuedMessageForThread(
      [
        { threadKey: "thread-b", text: "later" },
        { threadKey: "thread-a", text: "first" },
        { threadKey: "thread-a", text: "second" },
      ],
      "thread-a",
    );

    expect(result.message?.text).toBe("first");
    expect(result.remaining.map((entry) => entry.text)).toEqual(["later", "second"]);
  });
});

describe("replaceQueuedMessage", () => {
  it("swaps a queued message in place without affecting other threads", () => {
    const result = replaceQueuedMessage(
      [
        { id: "b-1", threadKey: "thread-b", text: "other" },
        { id: "a-1", threadKey: "thread-a", text: "editing" },
        { id: "a-2", threadKey: "thread-a", text: "later" },
      ],
      {
        id: "a-1",
        threadKey: "thread-a",
        replacement: { id: "a-3", threadKey: "thread-a", text: "current draft" },
      },
    );

    expect(result.message?.text).toBe("editing");
    expect(result.queue.map((entry) => entry.text)).toEqual(["other", "current draft", "later"]);
  });

  it("removes the queued message when there is no current draft", () => {
    const result = replaceQueuedMessage([{ id: "a-1", threadKey: "thread-a" }], {
      id: "a-1",
      threadKey: "thread-a",
      replacement: null,
    });

    expect(result.message?.id).toBe("a-1");
    expect(result.queue).toEqual([]);
  });
});
