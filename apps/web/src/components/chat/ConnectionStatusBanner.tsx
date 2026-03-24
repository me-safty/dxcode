import { memo, useEffect, useState } from "react";
import { onTransportStateChange, type TransportState } from "../../wsNativeApi";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { WifiOffIcon, CloudOffIcon } from "lucide-react";

export const ConnectionStatusBanner = memo(function ConnectionStatusBanner({
  initialIsOnline,
  initialTransportState,
}: {
  initialIsOnline?: boolean;
  initialTransportState?: TransportState;
}) {
  const [isOnline, setIsOnline] = useState(
    initialIsOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true),
  );
  const [transportState, setTransportState] = useState<TransportState>(
    initialTransportState ?? "open",
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const unsub = onTransportStateChange((state) => {
      setTransportState(state);
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsub();
    };
  }, []);

  const shouldShow =
    !isOnline ||
    (transportState !== "open" && transportState !== "connecting" && transportState !== "disposed");

  if (!shouldShow) {
    return null;
  }

  const title = !isOnline ? "No internet connection" : "Disconnected from server";
  const message = !isOnline
    ? "T3 Code is offline. Please check your internet connection."
    : transportState === "reconnecting"
      ? "Attempting to reconnect to the T3 Code server..."
      : "The connection to the T3 Code server was lost.";

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant="warning">
        {!isOnline ? <WifiOffIcon className="size-4" /> : <CloudOffIcon className="size-4" />}
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
});
