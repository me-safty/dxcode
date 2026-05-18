/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.nativeApi via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);

type NavigatorWithStandalone = Navigator & {
  readonly standalone?: boolean;
};

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined" || isElectron) {
    return false;
  }

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}
