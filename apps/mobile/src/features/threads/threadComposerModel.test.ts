import { describe, expect, it } from "vite-plus/test";

import { resolveThreadComposerSendLabel } from "./threadComposerModel";

describe("resolveThreadComposerSendLabel", () => {
  it("labels connected active-turn delivery as steering", () => {
    expect(
      resolveThreadComposerSendLabel({
        connectionState: "connected",
        activeThreadBusy: true,
        queueCount: 0,
        queuedRunCount: 0,
      }),
    ).toBe("Steer");
  });

  it("labels offline or backlogged delivery as queued", () => {
    expect(
      resolveThreadComposerSendLabel({
        connectionState: "offline",
        activeThreadBusy: true,
        queueCount: 0,
        queuedRunCount: 0,
      }),
    ).toBe("Queue");
    expect(
      resolveThreadComposerSendLabel({
        connectionState: "connected",
        activeThreadBusy: true,
        queueCount: 1,
        queuedRunCount: 0,
      }),
    ).toBe("Queue");
  });

  it("labels delivery behind server-queued runs as queued", () => {
    expect(
      resolveThreadComposerSendLabel({
        connectionState: "connected",
        activeThreadBusy: true,
        queueCount: 0,
        queuedRunCount: 2,
      }),
    ).toBe("Queue");
  });

  it("labels an idle connected delivery as send", () => {
    expect(
      resolveThreadComposerSendLabel({
        connectionState: "connected",
        activeThreadBusy: false,
        queueCount: 0,
        queuedRunCount: 0,
      }),
    ).toBe("Send");
  });
});
