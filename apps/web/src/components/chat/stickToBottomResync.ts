// Re-attach re-sync for the stick-to-bottom state machine.
//
// The timeline virtualizer only reports `isAtEnd` when it *changes*, and
// ChatView ignores "at end" reports during a short grace window after a user
// scroll. That combination can leave ChatView stuck thinking it is detached
// while the list is actually pinned to the bottom. After the grace window we
// re-check the list's real at-end state and re-attach if it is at the bottom.

interface StickToBottomResyncScheduler {
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export interface ScheduledAtEndResync {
  readonly cancel: () => void;
}

export interface ScheduleAtEndResyncInput {
  readonly delayMs: number;
  readonly isAtEnd: () => boolean;
  readonly onAtEnd: () => void;
  readonly scheduler?: StickToBottomResyncScheduler;
}

const defaultScheduler: StickToBottomResyncScheduler = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export function scheduleAtEndResync({
  delayMs,
  isAtEnd,
  onAtEnd,
  scheduler = defaultScheduler,
}: ScheduleAtEndResyncInput): ScheduledAtEndResync {
  let cancelled = false;

  const handle = scheduler.setTimeout(
    () => {
      if (cancelled) {
        return;
      }
      if (isAtEnd()) {
        onAtEnd();
      }
    },
    Math.max(0, delayMs),
  );

  return {
    cancel: () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      scheduler.clearTimeout(handle);
    },
  };
}
