import type { RefObject } from "react";
import type { VirtualizedListHandle } from "../virtualization/VirtualizedList";

export interface TimelineScrollAnchor {
  readonly anchorId: string;
  readonly offsetTop: number;
}

export interface ScheduledTimelineScrollAnchorRestore {
  readonly cancel: () => void;
}

export interface TimelinePrependScrollSnapshot {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly anchor: TimelineScrollAnchor | null;
}

export interface TimelineScrollAnchorScheduler {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

interface ScheduleTimelineScrollAnchorRestoreInput {
  readonly listRef: RefObject<VirtualizedListHandle | null>;
  readonly anchor: TimelineScrollAnchor;
  readonly shouldCancel?: () => boolean;
  readonly frameCount?: number;
  readonly settleDelaysMs?: readonly number[];
  readonly scheduler?: TimelineScrollAnchorScheduler;
}

interface ScheduleTimelinePrependScrollSnapshotRestoreInput {
  readonly listRef: RefObject<VirtualizedListHandle | null>;
  readonly snapshot: TimelinePrependScrollSnapshot;
  readonly shouldCancel?: () => boolean;
  readonly frameCount?: number;
  readonly settleDelaysMs?: readonly number[];
  readonly scheduler?: TimelineScrollAnchorScheduler;
}

interface ScheduleTimelineRestoreInput {
  readonly restore: () => void;
  readonly shouldCancel: (() => boolean) | undefined;
  readonly frameCount: number;
  readonly settleDelaysMs: readonly number[];
  readonly scheduler: TimelineScrollAnchorScheduler;
}

const TIMELINE_ANCHOR_SELECTOR = "[data-timeline-anchor-id]";
const TIMELINE_ANCHOR_IGNORE_SELECTOR = "[data-scroll-anchor-ignore]";
const TIMELINE_ANCHOR_RESTORE_FRAME_COUNT = 4;
const TIMELINE_ANCHOR_RESTORE_SETTLE_DELAYS_MS = [80, 180] as const;

const defaultScheduler: TimelineScrollAnchorScheduler = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

function getScrollableNode(listRef: VirtualizedListHandle | null): HTMLElement | null {
  return listRef?.getScrollableNode?.() ?? null;
}

function getTimelineAnchors(scrollableNode: HTMLElement): HTMLElement[] {
  return Array.from(scrollableNode.querySelectorAll<HTMLElement>(TIMELINE_ANCHOR_SELECTOR)).filter(
    (anchor) => anchor.closest(TIMELINE_ANCHOR_IGNORE_SELECTOR) === null,
  );
}

function getAnchorId(anchor: HTMLElement): string | null {
  const anchorId = anchor.dataset.timelineAnchorId;
  return anchorId && anchorId.length > 0 ? anchorId : null;
}

function getRelativeTop(anchor: HTMLElement, scrollableNode: HTMLElement): number {
  return anchor.getBoundingClientRect().top - scrollableNode.getBoundingClientRect().top;
}

function findTimelineAnchorById(scrollableNode: HTMLElement, anchorId: string): HTMLElement | null {
  for (const anchor of getTimelineAnchors(scrollableNode)) {
    if (getAnchorId(anchor) === anchorId) {
      return anchor;
    }
  }
  return null;
}

export function captureTimelineScrollAnchor(
  listRef: VirtualizedListHandle | null,
): TimelineScrollAnchor | null {
  const scrollableNode = getScrollableNode(listRef);
  if (!scrollableNode) {
    return null;
  }

  const scrollableRect = scrollableNode.getBoundingClientRect();
  let anchorElement: HTMLElement | null = null;
  let anchorTop = Number.POSITIVE_INFINITY;

  for (const anchor of getTimelineAnchors(scrollableNode)) {
    const anchorId = getAnchorId(anchor);
    if (!anchorId) {
      continue;
    }

    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.height <= 0 || anchorRect.bottom <= scrollableRect.top) {
      continue;
    }
    if (anchorRect.top >= scrollableRect.bottom) {
      continue;
    }
    if (anchorRect.top < anchorTop) {
      anchorTop = anchorRect.top;
      anchorElement = anchor;
    }
  }

  if (!anchorElement) {
    return null;
  }

  const anchorId = getAnchorId(anchorElement);
  if (!anchorId) {
    return null;
  }

  return {
    anchorId,
    offsetTop: getRelativeTop(anchorElement, scrollableNode),
  };
}

export function restoreTimelineScrollAnchor(
  listRef: VirtualizedListHandle | null,
  anchor: TimelineScrollAnchor,
): boolean {
  const scrollableNode = getScrollableNode(listRef);
  if (!scrollableNode) {
    return false;
  }

  const anchorElement = findTimelineAnchorById(scrollableNode, anchor.anchorId);
  if (!anchorElement) {
    return false;
  }

  const delta = getRelativeTop(anchorElement, scrollableNode) - anchor.offsetTop;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) {
    return true;
  }

  scrollableNode.scrollTop += delta;
  return true;
}

export function captureTimelinePrependScrollSnapshot(
  listRef: VirtualizedListHandle | null,
): TimelinePrependScrollSnapshot | null {
  const scrollableNode = getScrollableNode(listRef);
  if (!scrollableNode) {
    return null;
  }

  return {
    scrollTop: scrollableNode.scrollTop,
    scrollHeight: scrollableNode.scrollHeight,
    anchor: captureTimelineScrollAnchor(listRef),
  };
}

export function restoreTimelinePrependScrollSnapshot(
  listRef: VirtualizedListHandle | null,
  snapshot: TimelinePrependScrollSnapshot,
): boolean {
  const scrollableNode = getScrollableNode(listRef);
  if (!scrollableNode) {
    return false;
  }

  const heightDelta = scrollableNode.scrollHeight - snapshot.scrollHeight;
  const nextScrollTop = snapshot.scrollTop + heightDelta;
  if (Number.isFinite(nextScrollTop)) {
    scrollableNode.scrollTop = Math.max(0, nextScrollTop);
  }

  if (snapshot.anchor) {
    restoreTimelineScrollAnchor(listRef, snapshot.anchor);
  }
  return true;
}

export function scheduleTimelineScrollAnchorRestore({
  listRef,
  anchor,
  shouldCancel,
  frameCount = TIMELINE_ANCHOR_RESTORE_FRAME_COUNT,
  settleDelaysMs = TIMELINE_ANCHOR_RESTORE_SETTLE_DELAYS_MS,
  scheduler = defaultScheduler,
}: ScheduleTimelineScrollAnchorRestoreInput): ScheduledTimelineScrollAnchorRestore {
  return scheduleTimelineRestore({
    restore: () => restoreTimelineScrollAnchor(listRef.current, anchor),
    shouldCancel,
    frameCount,
    settleDelaysMs,
    scheduler,
  });
}

export function scheduleTimelinePrependScrollSnapshotRestore({
  listRef,
  snapshot,
  shouldCancel,
  frameCount = TIMELINE_ANCHOR_RESTORE_FRAME_COUNT,
  settleDelaysMs = TIMELINE_ANCHOR_RESTORE_SETTLE_DELAYS_MS,
  scheduler = defaultScheduler,
}: ScheduleTimelinePrependScrollSnapshotRestoreInput): ScheduledTimelineScrollAnchorRestore {
  return scheduleTimelineRestore({
    restore: () => restoreTimelinePrependScrollSnapshot(listRef.current, snapshot),
    shouldCancel,
    frameCount,
    settleDelaysMs,
    scheduler,
  });
}

function scheduleTimelineRestore({
  restore,
  shouldCancel,
  frameCount,
  settleDelaysMs,
  scheduler,
}: ScheduleTimelineRestoreInput): ScheduledTimelineScrollAnchorRestore {
  let cancelled = false;
  const frameHandles = new Set<number>();
  const timeoutHandles = new Set<number>();

  const cancel = () => {
    cancelled = true;
    for (const frameHandle of frameHandles) {
      scheduler.cancelAnimationFrame(frameHandle);
    }
    frameHandles.clear();
    for (const timeoutHandle of timeoutHandles) {
      scheduler.clearTimeout(timeoutHandle);
    }
    timeoutHandles.clear();
  };

  const isCancelled = () => {
    if (cancelled || shouldCancel?.()) {
      cancel();
      return true;
    }
    return false;
  };

  const scheduleFrameLoop = (remainingFrames: number) => {
    if (remainingFrames <= 0 || isCancelled()) {
      return;
    }

    const frameHandle = scheduler.requestAnimationFrame(() => {
      frameHandles.delete(frameHandle);
      if (isCancelled()) {
        return;
      }

      restore();
      scheduleFrameLoop(remainingFrames - 1);
    });
    frameHandles.add(frameHandle);
  };

  scheduleFrameLoop(frameCount);
  if (isCancelled()) {
    return { cancel };
  }

  for (const delay of settleDelaysMs) {
    const timeoutHandle = scheduler.setTimeout(() => {
      timeoutHandles.delete(timeoutHandle);
      scheduleFrameLoop(Math.max(1, Math.min(2, frameCount)));
    }, delay);
    timeoutHandles.add(timeoutHandle);
  }

  return { cancel };
}
