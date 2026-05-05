import { Schema } from "effect";
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

const clampRatio = (ratio: number) => Math.max(MIN_RATIO, Math.min(ratio, MAX_RATIO));

function readStoredRatio(storageKey: string | undefined) {
  if (!storageKey) return DEFAULT_RATIO;
  const storedRatio = getLocalStorageItem(storageKey, Schema.Finite);
  return storedRatio === null ? DEFAULT_RATIO : clampRatio(storedRatio);
}

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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const widthRatioRef = useRef(widthRatio);
  const resizeStateRef = useRef<{
    frameId: number | null;
    handle: HTMLDivElement;
    panel: HTMLDivElement;
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);

  useEffect(() => {
    setWidthRatio(readStoredRatio(storageKey));
  }, [storageKey]);

  useEffect(() => {
    widthRatioRef.current = widthRatio;
  }, [widthRatio]);

  const stopResize = useCallback(
    (pointerId: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      if (resizeState.frameId !== null) {
        window.cancelAnimationFrame(resizeState.frameId);
      }
      if (resizeState.handle.hasPointerCapture(pointerId)) {
        resizeState.handle.releasePointerCapture(pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      resizeStateRef.current = null;
      if (storageKey) {
        setLocalStorageItem(storageKey, widthRatioRef.current, Schema.Finite);
      }
    },
    [storageKey],
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
      panel,
      pointerId: event.pointerId,
      startWidth: panel.getBoundingClientRect().width,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();
    if (resizeState.frameId !== null) return;

    const clientX = event.clientX;
    resizeState.frameId = window.requestAnimationFrame(() => {
      const activeResizeState = resizeStateRef.current;
      if (!activeResizeState) return;

      activeResizeState.frameId = null;
      const containerWidth = activeResizeState.panel.parentElement?.clientWidth ?? 0;
      if (containerWidth <= 0) return;

      const nextWidth = activeResizeState.startWidth + activeResizeState.startX - clientX;
      const nextRatio = clampRatio(nextWidth / containerWidth);
      widthRatioRef.current = nextRatio;
      setWidthRatio(nextRatio);
    });
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState?.frameId !== null && resizeState?.frameId !== undefined) {
        window.cancelAnimationFrame(resizeState.frameId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
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
