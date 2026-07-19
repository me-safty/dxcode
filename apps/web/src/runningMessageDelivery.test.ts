import { describe, expect, it } from "vite-plus/test";

import {
  resolveRunningMessageBehavior,
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
