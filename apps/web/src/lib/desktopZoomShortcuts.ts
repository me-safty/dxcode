import type { ShortcutEventLike } from "../keybindings";
import { isMacPlatform } from "./utils";

export function isDesktopHandledZoomAccelerator(
  event: ShortcutEventLike,
  platform = navigator.platform,
): boolean {
  if (event.altKey) {
    return false;
  }

  if (isMacPlatform(platform)) {
    if (!event.metaKey || event.ctrlKey) {
      return false;
    }
  } else if (!event.ctrlKey || event.metaKey) {
    return false;
  }

  switch (event.code) {
    case "Equal":
    case "NumpadAdd":
      return true;
    case "Minus":
    case "Digit0":
      return !event.shiftKey;
    case "NumpadSubtract":
    case "Numpad0":
      return true;
  }

  switch (event.key) {
    case "=":
    case "+":
      return true;
    case "-":
    case "0":
      return !event.shiftKey;
    default:
      return false;
  }
}
