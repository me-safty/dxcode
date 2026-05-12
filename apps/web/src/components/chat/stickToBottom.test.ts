import { describe, expect, it, vi } from "vitest";

import { scheduleStickToBottom } from "./stickToBottom";

function createScheduler() {
  let nextFrameHandle = 1;
  let nextTimeoutHandle = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timeouts = new Map<number, () => void>();

  return {
    scheduler: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const handle = nextFrameHandle;
        nextFrameHandle += 1;
        frames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle: number) => {
        frames.delete(handle);
      },
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
    flushFrame: () => {
      const pending = Array.from(frames.entries());
      frames.clear();
      for (const [, callback] of pending) {
        callback(0);
      }
    },
    flushTimeouts: () => {
      const pending = Array.from(timeouts.entries());
      timeouts.clear();
      for (const [, callback] of pending) {
        callback();
      }
    },
    pendingFrameCount: () => frames.size,
    pendingTimeoutCount: () => timeouts.size,
  };
}

describe("scheduleStickToBottom", () => {
  it("retries across animation frames and delayed settle windows", () => {
    const scrollToEnd = vi.fn();
    const scheduler = createScheduler();

    scheduleStickToBottom({
      scrollToEnd,
      frameCount: 3,
      settleDelaysMs: [80],
      scheduler: scheduler.scheduler,
    });

    expect(scrollToEnd).not.toHaveBeenCalled();
    scheduler.flushFrame();
    scheduler.flushFrame();
    scheduler.flushFrame();
    expect(scrollToEnd).toHaveBeenCalledTimes(3);

    scheduler.flushTimeouts();
    scheduler.flushFrame();
    scheduler.flushFrame();
    expect(scrollToEnd).toHaveBeenCalledTimes(5);
  });

  it("cancels pending frame and timeout work", () => {
    const scrollToEnd = vi.fn();
    const scheduler = createScheduler();

    const scheduled = scheduleStickToBottom({
      scrollToEnd,
      frameCount: 3,
      settleDelaysMs: [80, 240],
      scheduler: scheduler.scheduler,
    });

    scheduled.cancel();
    scheduler.flushFrame();
    scheduler.flushTimeouts();

    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(scheduler.pendingFrameCount()).toBe(0);
    expect(scheduler.pendingTimeoutCount()).toBe(0);
  });
});
