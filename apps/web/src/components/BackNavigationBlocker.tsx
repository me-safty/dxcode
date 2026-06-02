import { type ShouldBlockFn, useBlocker } from "@tanstack/react-router";

import { shouldBlockBackNavigationAction } from "../navigationBlocking";

const shouldBlockBackNavigation: ShouldBlockFn = ({ action }) =>
  shouldBlockBackNavigationAction(action);

export function BackNavigationBlocker() {
  useBlocker({
    shouldBlockFn: shouldBlockBackNavigation,
    enableBeforeUnload: false,
  });

  return null;
}
