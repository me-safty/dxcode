import { useEffect, useRef } from "react";

export type MobileEdgeSwipeSide = "left" | "right";
export type MobileEdgeSwipeStartArea = "edge" | "screen";
export type MobileEdgeSwipeStartSurface = "any" | "outside-panels" | "panel";
export type MobileEdgeSwipeAction = "close" | "open";

export const MOBILE_EDGE_SWIPE_EDGE_WIDTH_PX = 64;
export const MOBILE_EDGE_SWIPE_TRIGGER_DISTANCE_PX = 56;
export const MOBILE_EDGE_SWIPE_VERTICAL_CANCEL_DISTANCE_PX = 18;
export const MOBILE_EDGE_SWIPE_HORIZONTAL_DOMINANCE_RATIO = 1.25;
export const MOBILE_EDGE_SWIPE_OPEN_INTENT_TIMEOUT_MS = 350;
export const MOBILE_EDGE_SWIPE_PANEL_ATTRIBUTE = "data-mobile-edge-swipe-panel";
// Mark a subtree where a horizontal drag should scroll/select content (e.g.
// markdown code blocks and inline code) instead of opening or dismissing a panel.
export const MOBILE_EDGE_SWIPE_BLOCK_ATTRIBUTE = "data-mobile-edge-swipe-block";
export const MOBILE_EDGE_SWIPE_SCROLL_START_TOLERANCE_PX = 1;

// A quick horizontal flick can trigger the action well before the sustained
// drag distance is reached. This lets the gesture win over a scrollable body,
// which otherwise cancels the swipe (via native scroll + touchcancel) before
// the slower distance threshold is met. A flick still has to clear a small
// distance and stay horizontally dominant so it does not fire on taps or
// vertical scrolls.
export const MOBILE_EDGE_SWIPE_FLICK_DISTANCE_PX = 24;
export const MOBILE_EDGE_SWIPE_FLICK_VELOCITY_PX_PER_MS = 0.5;

export type MobileEdgeSwipeDecision = "cancel" | MobileEdgeSwipeAction | "pending";

export interface MobileEdgeSwipeDelta {
  readonly action?: MobileEdgeSwipeAction;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly elapsedMs?: number;
  readonly side: MobileEdgeSwipeSide;
  /**
   * Instantaneous horizontal velocity (px/ms, signed like `deltaX`) sampled
   * from the most recent move. Used to recognize quick flicks.
   */
  readonly velocityX?: number;
}

export function isMobileEdgeSwipeStart({
  edgeWidth = MOBILE_EDGE_SWIPE_EDGE_WIDTH_PX,
  startArea = "edge",
  viewportWidth,
  x,
  side,
}: {
  readonly edgeWidth?: number;
  readonly startArea?: MobileEdgeSwipeStartArea;
  readonly viewportWidth: number;
  readonly x: number;
  readonly side: MobileEdgeSwipeSide;
}): boolean {
  if (startArea === "screen") {
    return x >= 0 && x <= viewportWidth;
  }

  return side === "left" ? x <= edgeWidth : viewportWidth - x <= edgeWidth;
}

export function resolveMobileEdgeSwipeDecision({
  action = "open",
  deltaX,
  deltaY,
  elapsedMs,
  side,
  velocityX = 0,
}: MobileEdgeSwipeDelta): MobileEdgeSwipeDecision {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  const openingDistance = side === "left" ? deltaX : -deltaX;
  const actionDistance = action === "open" ? openingDistance : -openingDistance;
  const openingVelocity = side === "left" ? velocityX : -velocityX;
  const actionVelocity = action === "open" ? openingVelocity : -openingVelocity;
  const isHorizontallyDominant =
    horizontalDistance >= verticalDistance * MOBILE_EDGE_SWIPE_HORIZONTAL_DOMINANCE_RATIO;

  // Quick flick in the action direction: trigger before the sustained drag
  // distance, while still requiring horizontal dominance so fast vertical
  // scrolling with incidental sideways motion does not open or close a panel.
  if (
    actionDistance >= MOBILE_EDGE_SWIPE_FLICK_DISTANCE_PX &&
    actionVelocity >= MOBILE_EDGE_SWIPE_FLICK_VELOCITY_PX_PER_MS &&
    isHorizontallyDominant
  ) {
    return action;
  }

  if (actionDistance >= MOBILE_EDGE_SWIPE_TRIGGER_DISTANCE_PX && isHorizontallyDominant) {
    if (
      action === "open" &&
      elapsedMs != null &&
      elapsedMs > MOBILE_EDGE_SWIPE_OPEN_INTENT_TIMEOUT_MS
    ) {
      return "cancel";
    }

    return action;
  }

  if (
    verticalDistance >= MOBILE_EDGE_SWIPE_VERTICAL_CANCEL_DISTANCE_PX &&
    !isHorizontallyDominant
  ) {
    return "cancel";
  }

  // Reuse the cancel threshold as an opposite-direction dead zone once the drag
  // has moved meaningfully away from the requested panel action.
  if (actionDistance <= -MOBILE_EDGE_SWIPE_VERTICAL_CANCEL_DISTANCE_PX) {
    return "cancel";
  }

  return "pending";
}

export function hasActiveTextSelection(
  selection: Pick<Selection, "isCollapsed" | "rangeCount"> | null | undefined,
): boolean {
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
}

export function isScrollPositionAtStart(
  scrollPosition: number,
  tolerance = MOBILE_EDGE_SWIPE_SCROLL_START_TOLERANCE_PX,
): boolean {
  return scrollPosition <= tolerance;
}

function isBlockedTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "[contenteditable='true']",
        `[${MOBILE_EDGE_SWIPE_BLOCK_ATTRIBUTE}='true']`,
        ".xterm",
      ].join(","),
    ),
  );
}

function isVerticallyScrollable(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + MOBILE_EDGE_SWIPE_SCROLL_START_TOLERANCE_PX;
}

function findNearestVerticalScrollableElement(target: EventTarget | null): HTMLElement | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return null;
  }

  for (let element: Element | null = target; element; element = element.parentElement) {
    if (
      typeof HTMLElement !== "undefined" &&
      element instanceof HTMLElement &&
      isVerticallyScrollable(element)
    ) {
      return element;
    }

    if (element.hasAttribute(MOBILE_EDGE_SWIPE_PANEL_ATTRIBUTE)) {
      return null;
    }
  }

  return null;
}

export function isNearestVerticalScrollableAtStart(
  target: EventTarget | null,
  tolerance = MOBILE_EDGE_SWIPE_SCROLL_START_TOLERANCE_PX,
): boolean {
  const scrollable = findNearestVerticalScrollableElement(target);
  return scrollable === null || isScrollPositionAtStart(scrollable.scrollTop, tolerance);
}

function isAcceptedStartSurface({
  side,
  startSurface,
  target,
}: {
  readonly side: MobileEdgeSwipeSide;
  readonly startSurface: MobileEdgeSwipeStartSurface;
  readonly target: EventTarget | null;
}): boolean {
  if (startSurface === "any") {
    return true;
  }

  if (!(target instanceof Element)) {
    return startSurface === "outside-panels";
  }

  const panel = target.closest<HTMLElement>(`[${MOBILE_EDGE_SWIPE_PANEL_ATTRIBUTE}]`);
  if (startSurface === "outside-panels") {
    return panel === null;
  }

  return panel?.getAttribute(MOBILE_EDGE_SWIPE_PANEL_ATTRIBUTE) === side;
}

function hasOpenSwipePanel(side: MobileEdgeSwipeSide): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${MOBILE_EDGE_SWIPE_PANEL_ATTRIBUTE}="${side}"]`),
  ).some((panel) => !panel.hidden);
}

export function useMobileEdgeSwipe({
  action = "open",
  blockedByOpenPanelSide,
  edgeWidth = MOBILE_EDGE_SWIPE_EDGE_WIDTH_PX,
  enabled,
  onSwipe,
  requireScrollableStartPosition = false,
  side,
  startArea = "edge",
  startSurface = "any",
}: {
  readonly action?: MobileEdgeSwipeAction;
  readonly blockedByOpenPanelSide?: MobileEdgeSwipeSide;
  readonly edgeWidth?: number;
  readonly enabled: boolean;
  readonly onSwipe: () => void;
  readonly requireScrollableStartPosition?: boolean;
  readonly side: MobileEdgeSwipeSide;
  readonly startArea?: MobileEdgeSwipeStartArea;
  readonly startSurface?: MobileEdgeSwipeStartSurface;
}) {
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    let activeSwipe: {
      id: number;
      source: "pointer" | "touch";
      startTime: number;
      startX: number;
      startY: number;
      lastTime: number;
      lastX: number;
    } | null = null;
    let ignorePointerUntil = 0;

    const startSwipe = ({
      id,
      source,
      startX,
      startY,
      target,
    }: {
      readonly id: number;
      readonly source: "pointer" | "touch";
      readonly startX: number;
      readonly startY: number;
      readonly target: EventTarget | null;
    }) => {
      if (
        hasActiveTextSelection(window.getSelection()) ||
        (blockedByOpenPanelSide !== undefined && hasOpenSwipePanel(blockedByOpenPanelSide)) ||
        !isAcceptedStartSurface({ side, startSurface, target }) ||
        (requireScrollableStartPosition && !isNearestVerticalScrollableAtStart(target)) ||
        !isMobileEdgeSwipeStart({
          edgeWidth,
          side,
          startArea,
          viewportWidth: window.innerWidth,
          x: startX,
        })
      ) {
        return;
      }

      const now = performance.now();
      activeSwipe = { id, source, startTime: now, startX, startY, lastTime: now, lastX: startX };
    };

    const updateSwipe = ({
      clientX,
      clientY,
      preventDefault,
    }: {
      readonly clientX: number;
      readonly clientY: number;
      readonly preventDefault: () => void;
    }) => {
      if (!activeSwipe) {
        return;
      }

      if (hasActiveTextSelection(window.getSelection())) {
        activeSwipe = null;
        return;
      }

      const now = performance.now();
      const sampleMs = now - activeSwipe.lastTime;
      const velocityX = sampleMs > 0 ? (clientX - activeSwipe.lastX) / sampleMs : 0;
      activeSwipe.lastTime = now;
      activeSwipe.lastX = clientX;

      const decision = resolveMobileEdgeSwipeDecision({
        deltaX: clientX - activeSwipe.startX,
        deltaY: clientY - activeSwipe.startY,
        elapsedMs: now - activeSwipe.startTime,
        action,
        side,
        velocityX,
      });

      if (decision === "pending") {
        return;
      }

      activeSwipe = null;
      if (decision === action) {
        preventDefault();
        onSwipeRef.current();
      }
    };

    const resetSwipe = () => {
      activeSwipe = null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isBlockedTarget(event.target)) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      ignorePointerUntil = performance.now() + 700;
      startSwipe({
        id: touch.identifier,
        source: "touch",
        startX: touch.clientX,
        startY: touch.clientY,
        target: event.target,
      });
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!activeSwipe || activeSwipe.source !== "touch") {
        return;
      }

      const touchId = activeSwipe.id;
      const touch = Array.from(event.changedTouches).find(
        (changedTouch) => changedTouch.identifier === touchId,
      );
      if (!touch) {
        return;
      }

      updateSwipe({
        clientX: touch.clientX,
        clientY: touch.clientY,
        preventDefault: () => event.preventDefault(),
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        performance.now() < ignorePointerUntil ||
        event.pointerType !== "touch" ||
        event.isPrimary === false ||
        isBlockedTarget(event.target)
      ) {
        return;
      }

      startSwipe({
        id: event.pointerId,
        source: "pointer",
        startX: event.clientX,
        startY: event.clientY,
        target: event.target,
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!activeSwipe || activeSwipe.source !== "pointer" || activeSwipe.id !== event.pointerId) {
        return;
      }

      updateSwipe({
        clientX: event.clientX,
        clientY: event.clientY,
        preventDefault: () => event.preventDefault(),
      });
    };

    window.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    window.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", resetSwipe, true);
    window.addEventListener("touchcancel", resetSwipe, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", resetSwipe, true);
    window.addEventListener("pointercancel", resetSwipe, true);

    return () => {
      window.removeEventListener("touchstart", handleTouchStart, true);
      window.removeEventListener("touchmove", handleTouchMove, true);
      window.removeEventListener("touchend", resetSwipe, true);
      window.removeEventListener("touchcancel", resetSwipe, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", resetSwipe, true);
      window.removeEventListener("pointercancel", resetSwipe, true);
    };
  }, [action, blockedByOpenPanelSide, edgeWidth, enabled, side, startArea, startSurface]);
}
