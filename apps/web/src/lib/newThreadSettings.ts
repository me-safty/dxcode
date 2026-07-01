import type { RuntimeMode, ServerSettings } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "../components/ui/toast";

export function getNewThreadRuntimeMode(serverSettings: ServerSettings | null): RuntimeMode | null {
  if (serverSettings) {
    return serverSettings.defaultRuntimeMode;
  }

  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not create thread",
      description: "Server settings are not available yet. No thread was created.",
    }),
  );
  return null;
}
