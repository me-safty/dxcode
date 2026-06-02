import type { VirtualizedListHandle } from "../virtualization/VirtualizedList";
import { describe, expect, it, vi } from "vitest";
import {
  captureTimelinePrependScrollSnapshot,
  captureTimelineScrollAnchor,
  restoreTimelinePrependScrollSnapshot,
  restoreTimelineScrollAnchor,
  scheduleTimelinePrependScrollSnapshotRestore,
  scheduleTimelineScrollAnchorRestore,
} from "./timelineScrollAnchor";

function makeRect(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeAnchor(id: string, top: number, bottom: number, ignored = false): HTMLElement {
  return {
    dataset: { timelineAnchorId: id },
    getBoundingClientRect: () => makeRect(top, bottom),
    closest: (selector: string) =>
      ignored && selector === "[data-scroll-anchor-ignore]" ? {} : null,
  } as unknown as HTMLElement;
}

function makeListRef(
  anchors: HTMLElement[],
  scrollTop = 0,
  scrollHeight = 1_000,
): VirtualizedListHandle {
  const scrollableNode = {
    scrollTop,
    scrollHeight,
    getBoundingClientRect: () => makeRect(0, 100),
    querySelectorAll: () => anchors,
  } as unknown as HTMLElement;

  return {
    getScrollableNode: () => scrollableNode,
  } as unknown as VirtualizedListHandle;
}

describe("timeline scroll anchor", () => {
  it("captures the first visible timeline anchor and its offset", () => {
    const listRef = makeListRef([
      makeAnchor("before", -80, -20),
      makeAnchor("anchor", -30, 30),
      makeAnchor("after", 30, 90),
    ]);

    expect(captureTimelineScrollAnchor(listRef)).toEqual({
      anchorId: "anchor",
      offsetTop: -30,
    });
  });

  it("ignores anchors inside scroll-anchor ignored controls", () => {
    const listRef = makeListRef([
      makeAnchor("ignored", -30, 30, true),
      makeAnchor("anchor", 40, 90),
    ]);

    expect(captureTimelineScrollAnchor(listRef)).toEqual({
      anchorId: "anchor",
      offsetTop: 40,
    });
  });

  it("restores by the anchor position delta", () => {
    const listRef = makeListRef([makeAnchor("anchor", 80, 140)], 200);

    expect(restoreTimelineScrollAnchor(listRef, { anchorId: "anchor", offsetTop: -30 })).toBe(true);
    expect(listRef.getScrollableNode()!.scrollTop).toBe(310);
  });

  it("restores individual work-entry anchors after regrouping", () => {
    const listRef = makeListRef([makeAnchor("work-entry:command-2", 60, 90)], 120);

    expect(
      restoreTimelineScrollAnchor(listRef, {
        anchorId: "work-entry:command-2",
        offsetTop: 10,
      }),
    ).toBe(true);
    expect(listRef.getScrollableNode()!.scrollTop).toBe(170);
  });

  it("captures scroll position, scroll height, and visible anchor for prepends", () => {
    const listRef = makeListRef(
      [makeAnchor("before", -80, -20), makeAnchor("anchor", 20, 70)],
      240,
      1_600,
    );

    expect(captureTimelinePrependScrollSnapshot(listRef)).toEqual({
      scrollTop: 240,
      scrollHeight: 1_600,
      anchor: {
        anchorId: "anchor",
        offsetTop: 20,
      },
    });
  });

  it("restores prepends by scroll-height delta when the anchor is missing", () => {
    const listRef = makeListRef([], 240, 2_000);

    expect(
      restoreTimelinePrependScrollSnapshot(listRef, {
        scrollTop: 240,
        scrollHeight: 1_600,
        anchor: { anchorId: "missing", offsetTop: 20 },
      }),
    ).toBe(true);
    expect(listRef.getScrollableNode()!.scrollTop).toBe(640);
  });

  it("applies anchor correction after scroll-height delta when the anchor exists", () => {
    const listRef = makeListRef([makeAnchor("anchor", 80, 140)], 240, 2_000);

    expect(
      restoreTimelinePrependScrollSnapshot(listRef, {
        scrollTop: 240,
        scrollHeight: 1_600,
        anchor: { anchorId: "anchor", offsetTop: 20 },
      }),
    ).toBe(true);
    expect(listRef.getScrollableNode()!.scrollTop).toBe(700);
  });

  it("keeps scheduled prepend snapshot restoration idempotent", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const listRef = { current: makeListRef([], 240, 2_000) };

    scheduleTimelinePrependScrollSnapshotRestore({
      listRef,
      snapshot: {
        scrollTop: 240,
        scrollHeight: 1_600,
        anchor: null,
      },
      frameCount: 3,
      settleDelaysMs: [],
      scheduler: {
        requestAnimationFrame,
        cancelAnimationFrame: vi.fn(),
        setTimeout: vi.fn(),
        clearTimeout: vi.fn(),
      },
    });

    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(0);
    }

    expect(requestAnimationFrame).toHaveBeenCalledTimes(3);
    expect(listRef.current.getScrollableNode()!.scrollTop).toBe(640);
  });

  it("cancels scheduled restoration when the user scroll token changes", () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    const listRef = { current: makeListRef([makeAnchor("anchor", 80, 140)], 200) };

    scheduleTimelineScrollAnchorRestore({
      listRef,
      anchor: { anchorId: "anchor", offsetTop: -30 },
      shouldCancel: () => true,
      scheduler: {
        requestAnimationFrame,
        cancelAnimationFrame: vi.fn(),
        setTimeout,
        clearTimeout,
      },
    });

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(listRef.current.getScrollableNode()!.scrollTop).toBe(200);
    expect(clearTimeout).not.toHaveBeenCalled();
  });

  it("cancels scheduled prepend snapshot restoration when the user scroll token changes", () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    const listRef = { current: makeListRef([], 200, 2_000) };

    scheduleTimelinePrependScrollSnapshotRestore({
      listRef,
      snapshot: {
        scrollTop: 200,
        scrollHeight: 1_600,
        anchor: null,
      },
      shouldCancel: () => true,
      scheduler: {
        requestAnimationFrame,
        cancelAnimationFrame: vi.fn(),
        setTimeout,
        clearTimeout,
      },
    });

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(listRef.current.getScrollableNode()!.scrollTop).toBe(200);
    expect(clearTimeout).not.toHaveBeenCalled();
  });
});
