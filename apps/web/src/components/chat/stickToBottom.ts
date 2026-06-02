export const STICK_TO_BOTTOM_SETTLE_DELAYS_MS = [80, 240] as const;
export const STICK_TO_BOTTOM_FRAME_COUNT = 3;
export const STICK_TO_BOTTOM_RESUME_LOCK_MS = 600;

interface StickToBottomScheduler {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export interface ScheduledStickToBottom {
  readonly cancel: () => void;
}

export interface ScheduleStickToBottomInput {
  readonly scrollToEnd: () => void;
  readonly frameCount?: number;
  readonly settleDelaysMs?: readonly number[];
  readonly scheduler?: StickToBottomScheduler;
}

const defaultScheduler: StickToBottomScheduler = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export function scheduleStickToBottom({
  scrollToEnd,
  frameCount = STICK_TO_BOTTOM_FRAME_COUNT,
  settleDelaysMs = STICK_TO_BOTTOM_SETTLE_DELAYS_MS,
  scheduler = defaultScheduler,
}: ScheduleStickToBottomInput): ScheduledStickToBottom {
  let cancelled = false;
  const frameHandles = new Set<number>();
  const timeoutHandles = new Set<number>();

  const scheduleFrameLoop = (remainingFrames: number) => {
    if (cancelled || remainingFrames <= 0) {
      return;
    }

    const frameHandle = scheduler.requestAnimationFrame(() => {
      frameHandles.delete(frameHandle);
      if (cancelled) {
        return;
      }

      scrollToEnd();
      scheduleFrameLoop(remainingFrames - 1);
    });
    frameHandles.add(frameHandle);
  };

  scheduleFrameLoop(frameCount);

  for (const delay of settleDelaysMs) {
    const timeoutHandle = scheduler.setTimeout(() => {
      timeoutHandles.delete(timeoutHandle);
      scheduleFrameLoop(Math.max(1, Math.min(2, frameCount)));
    }, delay);
    timeoutHandles.add(timeoutHandle);
  }

  return {
    cancel: () => {
      cancelled = true;
      for (const frameHandle of frameHandles) {
        scheduler.cancelAnimationFrame(frameHandle);
      }
      frameHandles.clear();
      for (const timeoutHandle of timeoutHandles) {
        scheduler.clearTimeout(timeoutHandle);
      }
      timeoutHandles.clear();
    },
  };
}
