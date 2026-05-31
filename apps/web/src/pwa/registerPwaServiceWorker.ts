import { registerSW } from "virtual:pwa-register";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { isElectron } from "../env";

let updateToastVisible = false;

export function registerPwaServiceWorker(): void {
  if (
    isElectron ||
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateReadyToast(updateServiceWorker);
    },
    onRegisterError(error) {
      console.warn("PWA service worker registration failed", error);
    },
  });
}

function showUpdateReadyToast(updateServiceWorker: () => Promise<void>): void {
  if (updateToastVisible) {
    return;
  }

  updateToastVisible = true;
  toastManager.add(
    stackedThreadToast({
      type: "info",
      title: "Update available",
      description: "Reload Salchi to use the latest web app version.",
      timeout: 0,
      data: {
        hideCopyButton: true,
        onClose: () => {
          updateToastVisible = false;
        },
        secondaryActionProps: {
          children: "Reload",
          onClick: () => {
            void updateServiceWorker();
          },
        },
        secondaryActionVariant: "default",
      },
    }),
  );
}
