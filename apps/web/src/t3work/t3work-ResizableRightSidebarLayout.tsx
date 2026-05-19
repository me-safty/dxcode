import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import * as Schema from "effect/Schema";
import { cn } from "~/lib/utils";
import { useMediaQuery } from "~/t3work/hooks/t3work-useMediaQuery";
import { getLocalStorageItem, setLocalStorageItem } from "~/t3work/hooks/t3work-useLocalStorage";
import { ResizableRightSidebarAside } from "./t3work-ResizableRightSidebarAside";

type ResizableRightSidebarLayoutProps = {
  main: ReactNode;
  aside: ReactNode;
  storageKey: string;
  className?: string;
  mainClassName?: string;
  asideClassName?: string;
  minAsideWidth?: number;
  defaultAsideWidth?: number;
  minMainWidth?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readStoredCollapsedState(storageKey: string): boolean {
  try {
    const stored = getLocalStorageItem(storageKey, Schema.Boolean);
    return stored ?? false;
  } catch {
    if (typeof window === "undefined") {
      return false;
    }

    const legacyValue = window.localStorage.getItem(storageKey);
    if (legacyValue === "1") {
      setLocalStorageItem(storageKey, true, Schema.Boolean);
      return true;
    }
    if (legacyValue === "0") {
      setLocalStorageItem(storageKey, false, Schema.Boolean);
      return false;
    }
    return false;
  }
}

export function ResizableRightSidebarLayout({
  main,
  aside,
  storageKey,
  className,
  mainClassName,
  asideClassName,
  minAsideWidth = 22 * 16,
  defaultAsideWidth = 26 * 16,
  minMainWidth = 44 * 16,
}: ResizableRightSidebarLayoutProps) {
  const isDesktop = useMediaQuery("lg");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [asideWidth, setAsideWidth] = useState(defaultAsideWidth);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const widthStorageKey = `${storageKey}:width`;
  const collapsedStorageKey = `${storageKey}:collapsed`;
  const dragStateRef = useRef<{
    currentWidth: number;
    pointerId: number;
    startX: number;
    startWidth: number;
    handle: HTMLButtonElement;
  } | null>(null);

  useEffect(() => {
    const storedWidth = getLocalStorageItem(widthStorageKey, Schema.Finite);
    if (storedWidth !== null) {
      setAsideWidth(storedWidth);
    }

    if (readStoredCollapsedState(collapsedStorageKey)) {
      setIsCollapsed(true);
    }
  }, [collapsedStorageKey, widthStorageKey]);

  useEffect(
    () => () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [],
  );

  const setCollapsedState = useCallback(
    (nextCollapsed: boolean) => {
      setIsCollapsed(nextCollapsed);
      setLocalStorageItem(collapsedStorageKey, nextCollapsed, Schema.Boolean);
    },
    [collapsedStorageKey],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isDesktop || event.button !== 0 || !containerRef.current || isCollapsed) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      dragStateRef.current = {
        currentWidth: asideWidth,
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: asideWidth,
        handle: event.currentTarget,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [asideWidth, isCollapsed, isDesktop],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current;
      const container = containerRef.current;
      if (!dragState || !container || dragState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const delta = dragState.startX - event.clientX;
      const maxAsideWidth = Math.max(minAsideWidth, container.clientWidth - minMainWidth);
      const nextWidth = clamp(dragState.startWidth + delta, minAsideWidth, maxAsideWidth);
      dragState.currentWidth = nextWidth;
      setAsideWidth(nextWidth);
    },
    [minAsideWidth, minMainWidth],
  );

  const stopResize = useCallback(
    (pointerId: number) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== pointerId) {
        return;
      }

      dragStateRef.current = null;
      if (dragState.handle.hasPointerCapture(pointerId)) {
        dragState.handle.releasePointerCapture(pointerId);
      }
      setLocalStorageItem(widthStorageKey, dragState.currentWidth, Schema.Finite);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [widthStorageKey],
  );

  const handleResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  const handleResizePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  if (!isDesktop) {
    return (
      <div className={cn("grid min-h-0 flex-1 grid-cols-1", className)}>
        <div className={cn("min-h-0 min-w-0 overflow-hidden", mainClassName)}>{main}</div>
        <div className={cn("min-h-0 overflow-hidden", asideClassName)}>{aside}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full min-h-0 flex flex-1 overflow-hidden", className)}
      style={
        {
          "--right-sidebar-width": `${asideWidth}px`,
        } as CSSProperties
      }
    >
      <div className={cn("h-full min-h-0 min-w-0 flex-1 overflow-hidden", mainClassName)}>
        {main}
      </div>
      <ResizableRightSidebarAside
        aside={aside}
        asideClassName={asideClassName}
        asideWidth={asideWidth}
        isCollapsed={isCollapsed}
        onResizePointerCancel={handleResizePointerCancel}
        onResizePointerDown={handleResizePointerDown}
        onResizePointerMove={handleResizePointerMove}
        onResizePointerUp={handleResizePointerUp}
        onToggleCollapsed={() => setCollapsedState(!isCollapsed)}
      />
    </div>
  );
}
