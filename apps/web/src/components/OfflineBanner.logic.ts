/**
 * Visual modes for the top-of-app offline banner.
 *
 * - `hidden`: online with nothing to announce.
 * - `offline`: the device has no network connection.
 * - `reconnected`: the network just came back; shown briefly, then dismissed.
 */
export type OfflineBannerMode = "hidden" | "offline" | "reconnected";

/**
 * Pure transition for the offline banner driven by the browser network state.
 *
 * The `reconnected` (green) state is only ever entered when recovering from a
 * previous `offline` state, so a normal first load never flashes "Back online".
 * Dismissing the `reconnected` state after its timeout is handled separately by
 * the component (it sets the mode back to `hidden`).
 */
export function nextOfflineBannerMode(prev: OfflineBannerMode, online: boolean): OfflineBannerMode {
  if (!online) {
    return "offline";
  }
  if (prev === "offline") {
    return "reconnected";
  }
  return prev;
}
