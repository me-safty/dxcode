export function resolveBrowserRecordingStopTarget(
  requestedTabId: string | null,
  activeTabId: string | null,
): string | null {
  return requestedTabId !== null && requestedTabId === activeTabId ? requestedTabId : null;
}
