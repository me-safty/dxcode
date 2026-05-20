import { useCallback, useEffect, useRef } from "react";
import type { MouseEventHandler, PointerEventHandler } from "react";

export const LONG_PRESS_CONTEXT_MENU_DELAY_MS = 500;
export const LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX = 10;
const SUPPRESS_FOLLOW_UP_EVENT_MS = 1_200;

const nestedInteractiveSelector = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[data-long-press-context-menu-block='true']",
].join(",");

export interface LongPressContextMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface LongPressPointerStartInput {
  readonly button: number;
  readonly isPrimary: boolean;
  readonly pointerType: string;
}

export interface LongPressMoveInput {
  readonly currentX: number;
  readonly currentY: number;
  readonly startX: number;
  readonly startY: number;
  readonly tolerance?: number;
}

interface ActiveLongPress {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  readonly timerId: number;
}

export function shouldStartLongPressContextMenu(input: LongPressPointerStartInput): boolean {
  return input.pointerType === "touch" && input.isPrimary && input.button === 0;
}

export function hasLongPressMovedBeyondTolerance({
  currentX,
  currentY,
  startX,
  startY,
  tolerance = LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX,
}: LongPressMoveInput): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > tolerance;
}

function hasNestedInteractiveTarget(
  target: EventTarget | null,
  currentTarget: EventTarget,
): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }

  const interactiveTarget = target.closest(nestedInteractiveSelector);
  return interactiveTarget !== null && interactiveTarget !== currentTarget;
}

function now() {
  return Date.now();
}

export function useLongPressContextMenu<TElement extends HTMLElement>({
  delayMs = LONG_PRESS_CONTEXT_MENU_DELAY_MS,
  enabled = true,
  moveTolerancePx = LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX,
  onLongPress,
}: {
  readonly delayMs?: number;
  readonly enabled?: boolean;
  readonly moveTolerancePx?: number;
  readonly onLongPress: (position: LongPressContextMenuPosition) => void | Promise<void>;
}): {
  readonly onClickCapture: MouseEventHandler<TElement>;
  readonly onContextMenuCapture: MouseEventHandler<TElement>;
  readonly onPointerCancelCapture: PointerEventHandler<TElement>;
  readonly onPointerDownCapture: PointerEventHandler<TElement>;
  readonly onPointerMoveCapture: PointerEventHandler<TElement>;
  readonly onPointerUpCapture: PointerEventHandler<TElement>;
} {
  const activeLongPressRef = useRef<ActiveLongPress | null>(null);
  const suppressClickUntilRef = useRef(0);
  const suppressContextMenuUntilRef = useRef(0);
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const cancelLongPress = useCallback(() => {
    const activeLongPress = activeLongPressRef.current;
    if (!activeLongPress) {
      return;
    }

    window.clearTimeout(activeLongPress.timerId);
    activeLongPressRef.current = null;
  }, []);

  const handlePointerDownCapture = useCallback<PointerEventHandler<TElement>>(
    (event) => {
      cancelLongPress();
      if (
        !enabled ||
        !shouldStartLongPressContextMenu({
          button: event.button,
          isPrimary: event.isPrimary,
          pointerType: event.pointerType,
        }) ||
        hasNestedInteractiveTarget(event.target, event.currentTarget)
      ) {
        return;
      }

      const pointerId = event.pointerId;
      const timerId = window.setTimeout(() => {
        const activeLongPress = activeLongPressRef.current;
        if (!activeLongPress || activeLongPress.pointerId !== pointerId) {
          return;
        }

        activeLongPressRef.current = null;
        const suppressUntil = now() + SUPPRESS_FOLLOW_UP_EVENT_MS;
        suppressClickUntilRef.current = suppressUntil;
        suppressContextMenuUntilRef.current = suppressUntil;
        void onLongPressRef.current({
          x: activeLongPress.lastX,
          y: activeLongPress.lastY,
        });
      }, delayMs);

      activeLongPressRef.current = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        timerId,
      };
    },
    [cancelLongPress, delayMs, enabled],
  );

  const handlePointerMoveCapture = useCallback<PointerEventHandler<TElement>>(
    (event) => {
      const activeLongPress = activeLongPressRef.current;
      if (!activeLongPress || activeLongPress.pointerId !== event.pointerId) {
        return;
      }

      activeLongPress.lastX = event.clientX;
      activeLongPress.lastY = event.clientY;

      if (
        hasLongPressMovedBeyondTolerance({
          currentX: event.clientX,
          currentY: event.clientY,
          startX: activeLongPress.startX,
          startY: activeLongPress.startY,
          tolerance: moveTolerancePx,
        })
      ) {
        cancelLongPress();
      }
    },
    [cancelLongPress, moveTolerancePx],
  );

  const handlePointerEndCapture = useCallback<PointerEventHandler<TElement>>(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handleClickCapture = useCallback<MouseEventHandler<TElement>>((event) => {
    if (now() > suppressClickUntilRef.current) {
      return;
    }

    suppressClickUntilRef.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleContextMenuCapture = useCallback<MouseEventHandler<TElement>>(
    (event) => {
      if (now() <= suppressContextMenuUntilRef.current) {
        suppressContextMenuUntilRef.current = 0;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      cancelLongPress();
    },
    [cancelLongPress],
  );

  useEffect(() => {
    if (!enabled) {
      cancelLongPress();
    }

    return cancelLongPress;
  }, [cancelLongPress, enabled]);

  return {
    onClickCapture: handleClickCapture,
    onContextMenuCapture: handleContextMenuCapture,
    onPointerCancelCapture: handlePointerEndCapture,
    onPointerDownCapture: handlePointerDownCapture,
    onPointerMoveCapture: handlePointerMoveCapture,
    onPointerUpCapture: handlePointerEndCapture,
  };
}
