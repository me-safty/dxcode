import { memo, useEffect, useState } from "react";

import { cn } from "../lib/utils";
import { useWsConnectionStatus } from "../rpc/wsConnectionState";
import {
  type ConnectionIndicatorTone,
  type ConnectionIndicatorView,
  deriveConnectionIndicator,
} from "./ConnectionStatusIndicator.logic";
import { Spinner } from "./ui/spinner";

/**
 * Re-renders once per second while a timed reconnect is pending so the
 * countdown in the detail line stays live. Idle otherwise.
 */
function useConnectionIndicatorView(): ConnectionIndicatorView {
  const status = useWsConnectionStatus();
  const ticking = status.reconnectPhase === "waiting" && status.nextRetryAt !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) {
      return;
    }
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [ticking]);

  return deriveConnectionIndicator(status, nowMs);
}

function ConnectionGlyph({
  tone,
  className,
}: {
  tone: ConnectionIndicatorTone;
  className?: string;
}) {
  if (tone === "syncing") {
    return <Spinner aria-hidden className={cn("size-3 text-muted-foreground", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full",
        tone === "online" ? "bg-emerald-500" : "animate-pulse bg-destructive",
        className,
      )}
    />
  );
}

/** Ambient connection pill for the sidebar footer, matching the usage row. */
export const SidebarConnectionStatus = memo(function SidebarConnectionStatus() {
  const view = useConnectionIndicatorView();

  return (
    <div
      className="flex h-7 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground/70"
      title={`${view.label} — ${view.detail}`}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <ConnectionGlyph tone={view.tone} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">Connection</span>
      <span className="shrink-0 truncate text-[10px] tabular-nums text-muted-foreground/70">
        {view.label}
      </span>
    </div>
  );
});
