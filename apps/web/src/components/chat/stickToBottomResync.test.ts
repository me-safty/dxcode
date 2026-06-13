import { describe, expect, it, vi } from "vitest";

import { scheduleAtEndResync } from "./stickToBottomResync";

function createScheduler() {
  let nextTimeoutHandle = 1;
  const timeouts = new Map<number, () => void>();

  return {
    scheduler: {
      setTimeout: (callback: () => void) => {
        const handle = nextTimeoutHandle;
        nextTimeoutHandle += 1;
        timeouts.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle: number) => {
        timeouts.delete(handle);
      },
    },
    flushTimeouts: () => {
      const pending = Array.from(timeouts.entries());
      timeouts.clear();
      for (const [, callback] of pending) {
        callback();
      }
    },
    pendingTimeoutCount: () => timeouts.size,
  };
}

describe("scheduleAtEndResync", () => {
  it("re-attaches after the delay when the list is at the end", () => {
    const onAtEnd = vi.fn();
    const scheduler = createScheduler();

    scheduleAtEndResync({
      delayMs: 1200,
      isAtEnd: () => true,
      onAtEnd,
      scheduler: scheduler.scheduler,
    });

    expect(onAtEnd).not.toHaveBeenCalled();
    scheduler.flushTimeouts();
    expect(onAtEnd).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the list is not at the end", () => {
    const onAtEnd = vi.fn();
    const scheduler = createScheduler();

    scheduleAtEndResync({
      delayMs: 1200,
      isAtEnd: () => false,
      onAtEnd,
      scheduler: scheduler.scheduler,
    });

    scheduler.flushTimeouts();
    expect(onAtEnd).not.toHaveBeenCalled();
  });

  it("cancel() prevents the resync from firing", () => {
    const onAtEnd = vi.fn();
    const isAtEnd = vi.fn(() => true);
    const scheduler = createScheduler();

    const scheduled = scheduleAtEndResync({
      delayMs: 1200,
      isAtEnd,
      onAtEnd,
      scheduler: scheduler.scheduler,
    });

    scheduled.cancel();
    scheduler.flushTimeouts();

    expect(isAtEnd).not.toHaveBeenCalled();
    expect(onAtEnd).not.toHaveBeenCalled();
    expect(scheduler.pendingTimeoutCount()).toBe(0);
  });
});
