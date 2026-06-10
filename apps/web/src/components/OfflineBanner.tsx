import { memo, useEffect, useState } from "react";
import { WifiIcon, WifiOffIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { useWsConnectionStatus } from "../rpc/wsConnectionState";
import { nextOfflineBannerMode, type OfflineBannerMode } from "./OfflineBanner.logic";

/** How long the green "Back online" confirmation stays before auto-dismissing. */
const RECONNECTED_VISIBLE_MS = 3_000;

/**
 * Full-width banner pinned to the top of the app. Turns red while the device is
 * offline (no network / no data) and briefly green once the network returns,
 * then hides itself. Keyed purely off the browser online/offline state exposed
 * by {@link useWsConnectionStatus}.
 */
export const OfflineBanner = memo(function OfflineBanner() {
  const online = useWsConnectionStatus().online;
  const [mode, setMode] = useState<OfflineBannerMode>(() => (online ? "hidden" : "offline"));

  // Drive offline ↔ reconnected transitions from the browser network state.
  useEffect(() => {
    setMode((prev) => nextOfflineBannerMode(prev, online));
  }, [online]);

  // Auto-dismiss the green "Back online" confirmation after a short delay.
  useEffect(() => {
    if (mode !== "reconnected") {
      return;
    }
    const timeoutId = window.setTimeout(() => setMode("hidden"), RECONNECTED_VISIBLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [mode]);

  if (mode === "hidden") {
    return null;
  }

  const isReconnected = mode === "reconnected";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium text-white shadow-sm",
        "pt-[max(0.375rem,env(safe-area-inset-top))]",
        isReconnected ? "bg-success" : "bg-destructive",
      )}
    >
      {isReconnected ? (
        <WifiIcon aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <WifiOffIcon aria-hidden className="size-3.5 shrink-0" />
      )}
      <span>{isReconnected ? "Back online" : "You're offline — check your connection."}</span>
    </div>
  );
});
