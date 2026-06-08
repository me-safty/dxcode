import { describe, expect, it } from "vitest";
import type { OrchestrationEvent } from "@t3tools/contracts";

import {
  THREAD_DETAIL_ORCHESTRATION_EVENT_TYPES,
  isThreadDetailOrchestrationEvent,
} from "./orchestrationThreadDetailEvents.js";

function makeEvent(type: OrchestrationEvent["type"]): OrchestrationEvent {
  return { type } as OrchestrationEvent;
}

describe("orchestration thread detail events", () => {
  it("includes queued lifecycle events as thread detail events", () => {
    expect(THREAD_DETAIL_ORCHESTRATION_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "thread.turn-queued",
        "thread.queued-turn-cancelled",
        "thread.queued-turn-dispatched",
      ]),
    );

    expect(isThreadDetailOrchestrationEvent(makeEvent("thread.turn-queued"))).toBe(true);
    expect(isThreadDetailOrchestrationEvent(makeEvent("thread.queued-turn-cancelled"))).toBe(true);
    expect(isThreadDetailOrchestrationEvent(makeEvent("thread.queued-turn-dispatched"))).toBe(true);
  });

  it("includes existing message, activity, session, plan, diff, and revert detail events", () => {
    for (const type of [
      "thread.message-sent",
      "thread.proposed-plan-upserted",
      "thread.activity-appended",
      "thread.turn-diff-completed",
      "thread.reverted",
      "thread.session-set",
    ] as const) {
      expect(isThreadDetailOrchestrationEvent(makeEvent(type))).toBe(true);
    }
  });

  it("excludes unrelated project and shell-only thread events", () => {
    for (const type of [
      "project.created",
      "project.meta-updated",
      "thread.created",
      "thread.archived",
      "thread.turn-start-requested",
      "thread.turn-interrupt-requested",
    ] as const) {
      expect(isThreadDetailOrchestrationEvent(makeEvent(type))).toBe(false);
    }
  });
});
