import type { DesktopAppBranding } from "@t3tools/contracts";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const hostedAppChannel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();

export const HOSTED_APP_CHANNEL =
  hostedAppChannel === "latest" || hostedAppChannel === "nightly" ? hostedAppChannel : null;
export const HOSTED_APP_CHANNEL_LABEL =
  HOSTED_APP_CHANNEL === "nightly" ? "Nightly" : HOSTED_APP_CHANNEL === "latest" ? "Latest" : null;

// The product word shown beside the T3 wordmark and used to build the full
// app name. Forks override this via VITE_APP_NAME without touching code.
export const APP_NAME = import.meta.env.VITE_APP_NAME?.trim() || "Code";
export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? `T3 ${APP_NAME}`;
export const APP_DISPLAY_NAME = injectedDesktopAppBranding?.displayName ?? APP_BASE_NAME;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
