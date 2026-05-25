import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

const DEFAULT_RATIO = 0.4;
const MIN_RATIO = 0.3;
const MAX_RATIO = 0.8;
let bodyResizeStyleOwner: symbol | null = null;

const clampRatio = (ratio: number) => Math.max(MIN_RATIO, Math.min(ratio, MAX_RATIO));

function readStoredRatio(storageKey: string | undefined) {
  if (!storageKey) return DEFAULT_RATIO;
  try {
    const storedRatio = getLocalStorageItem(storageKey, Schema.Finite);
    return storedRatio === null ? DEFAULT_RATIO : clampRatio(storedRatio);
  } catch (error) {
    console.error("[LOCALSTORAGE] Error:", error);
    return DEFAULT_RATIO;
  }
}

const applyBodyResizeStyles = (owner: symbol) => {
  bodyResizeStyleOwner = owner;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
};

const clearBodyResizeStyles = (owner: symbol) => {
  if (bodyResizeStyleOwner !== owner) return;
  document.body.style.removeProperty("cursor");
  document.body.style.removeProperty("user-select");
  bodyResizeStyleOwner = null;
};

export function ResizableRightPanel({
  children,
  className,
  storageKey,
}: {
  children: ReactNode;
  className?: string;
  storageKey?: string;
}) {
  const [widthRatio, setWidthRatio] = useState(() => readStoredRatio(storageKey));
  const resizeOwnerRef = useRef(Symbol("ResizableRightPanel"));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const widthRatioRef = useRef(widthRatio);
  const resizeStateRef = useRef<{
    frameId: number | null;
    handle: HTMLDivElement;
    latestX: number;
    panel: HTMLDivElement;
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);

  const commitWidthRatio = useCallback((ratio: number) => {
    widthRatioRef.current = ratio;
    setWidthRatio(ratio);
  }, []);

  const commitResizePosition = useCallback(
    (
      resizeState: {
        panel: HTMLDivElement;
        startWidth: number;
        startX: number;
      },
      clientX: number,
    ) => {
      const containerWidth = resizeState.panel.parentElement?.clientWidth ?? 0;
      if (containerWidth <= 0) return;

      const nextWidth = resizeState.startWidth + resizeState.startX - clientX;
      commitWidthRatio(clampRatio(nextWidth / containerWidth));
    },
    [commitWidthRatio],
  );

  const stopResize = useCallback(
    (pointerId: number, finalClientX?: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      if (resizeState.frameId !== null) {
        window.cancelAnimationFrame(resizeState.frameId);
      }
      commitResizePosition(resizeState, finalClientX ?? resizeState.latestX);
      if (resizeState.handle.hasPointerCapture(pointerId)) {
        resizeState.handle.releasePointerCapture(pointerId);
      }
      clearBodyResizeStyles(resizeOwnerRef.current);
      resizeStateRef.current = null;
      if (storageKey) {
        setLocalStorageItem(storageKey, widthRatioRef.current, Schema.Finite);
      }
    },
    [commitResizePosition, storageKey],
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;

    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      frameId: null,
      handle: event.currentTarget,
      latestX: event.clientX,
      panel,
      pointerId: event.pointerId,
      startWidth: panel.getBoundingClientRect().width,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    applyBodyResizeStyles(resizeOwnerRef.current);
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      resizeState.latestX = event.clientX;

      if (resizeState.frameId !== null) return;
      resizeState.frameId = window.requestAnimationFrame(() => {
        const activeResizeState = resizeStateRef.current;
        if (!activeResizeState) return;

        activeResizeState.frameId = null;
        commitResizePosition(activeResizeState, activeResizeState.latestX);
      });
    },
    [commitResizePosition],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      stopResize(event.pointerId, event.clientX);
    },
    [stopResize],
  );

  useEffect(() => {
    const resizeOwner = resizeOwnerRef.current;
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState?.frameId !== null && resizeState?.frameId !== undefined) {
        window.cancelAnimationFrame(resizeState.frameId);
      }
      clearBodyResizeStyles(resizeOwner);
    };
  }, []);

  return (
    <div
      className={cn("relative min-h-0 shrink-0", className)}
      ref={panelRef}
      style={{ width: `${widthRatio * 100}%` }}
    >
      <div
        aria-label="Resize right panel"
        className="absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-border"
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="separator"
        tabIndex={-1}
        title="Drag to resize right panel"
      />
      {children}
    </div>
  );
}
