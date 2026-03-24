/**
 * Native-window background colors that match the app's CSS theme tokens.
 *
 * Dark  → `color-mix(in srgb, neutral-950 95%, white)` ≈ #161616
 * Light → white
 *
 * Used by the Electron main process to set `BrowserWindow.backgroundColor`
 * so resizing never flashes a mismatched color.
 */
export const THEME_BG_DARK = "#161616";
export const THEME_BG_LIGHT = "#ffffff";
