// Direction-aware "scroll-away intent" detection for the messages timeline.
//
// Only scrolling *up* should detach the timeline from the bottom. Scrolling
// down (or wheeling while already at the bottom) must not detach, otherwise the
// stick-to-bottom state gets stuck "detached" and streaming stops following.

/**
 * A wheel event scrolls away from the bottom only when it scrolls up
 * (negative deltaY). Downward and horizontal wheels are not scroll-away intent.
 */
export function isWheelScrollAwayIntent(deltaY: number): boolean {
  return deltaY < 0;
}

export interface TouchScrollIntentTracker {
  /** Begin tracking a new touch gesture at the given clientY. */
  readonly touchStart: (clientY: number) => void;
  /**
   * Report a touch move at the given clientY. Returns true when the finger is
   * moving *down* the screen (clientY increasing), which scrolls the content
   * up — i.e. scroll-away intent.
   */
  readonly touchMove: (clientY: number) => boolean;
}

export function createTouchScrollIntentTracker(): TouchScrollIntentTracker {
  let lastClientY: number | null = null;

  return {
    touchStart: (clientY: number) => {
      lastClientY = clientY;
    },
    touchMove: (clientY: number) => {
      if (lastClientY === null) {
        lastClientY = clientY;
        return false;
      }
      const delta = clientY - lastClientY;
      lastClientY = clientY;
      // Finger moving down the screen (delta > 0) drags content up = scroll up.
      return delta > 0;
    },
  };
}
