import type { DesktopWindowState } from "@t3tools/contracts";
import { MinusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";

function canControlDesktopWindow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.minimizeWindow === "function" &&
    typeof window.desktopBridge?.toggleMaximizeWindow === "function" &&
    typeof window.desktopBridge?.closeWindow === "function"
  );
}

function MaximizeGlyph() {
  return <span aria-hidden="true" className="block size-[10px] border border-current" />;
}

function RestoreGlyph() {
  return (
    <span aria-hidden="true" className="relative block size-[10px]">
      <span className="absolute right-0 top-0 size-[8px] border border-current bg-transparent" />
      <span className="absolute bottom-0 left-0 size-[8px] border border-current bg-transparent" />
    </span>
  );
}

export function DesktopWindowControls(props: { className?: string }) {
  const [windowState, setWindowState] = useState<DesktopWindowState>({ maximized: false });
  const available = canControlDesktopWindow();

  useEffect(() => {
    if (!available) {
      return;
    }
    const bridge = window.desktopBridge;
    if (!bridge) {
      return;
    }
    let disposed = false;
    void bridge
      .getWindowState()
      .then((nextState) => {
        if (!disposed) {
          setWindowState(nextState);
        }
      })
      .catch(() => undefined);
    const unsubscribe = bridge.onWindowState((nextState) => {
      if (!disposed) {
        setWindowState(nextState);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [available]);

  if (!available) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex h-full items-stretch gap-0 [-webkit-app-region:no-drag]",
        props.className,
      )}
    >
      <button
        type="button"
        aria-label="Minimize window"
        className="inline-flex h-full w-[46px] items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
        onClick={() => {
          void window.desktopBridge?.minimizeWindow();
        }}
      >
        <MinusIcon className="size-3" />
      </button>
      <button
        type="button"
        aria-label={windowState.maximized ? "Restore window" : "Maximize window"}
        className="inline-flex h-full w-[46px] items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
        onClick={() => {
          void window.desktopBridge
            ?.toggleMaximizeWindow()
            .then((nextState) => {
              setWindowState(nextState);
            })
            .catch(() => undefined);
        }}
      >
        {windowState.maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        aria-label="Close window"
        className="inline-flex h-full w-[46px] items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-[#c42b1c] hover:text-white"
        onClick={() => {
          void window.desktopBridge?.closeWindow();
        }}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
