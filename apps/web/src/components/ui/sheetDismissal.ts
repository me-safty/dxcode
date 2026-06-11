import type { ComponentProps } from "react";

import { Sheet } from "./sheet";

const TOAST_PORTAL_SELECTOR = '[data-slot="toast-portal"], [data-slot="toast-portal-anchored"]';

type SheetOpenChangeDetails = Parameters<
  NonNullable<ComponentProps<typeof Sheet>["onOpenChange"]>
>[1];

function targetIsInToastPortal(target: EventTarget | null | undefined): boolean {
  return target instanceof Element && target.closest(TOAST_PORTAL_SELECTOR) !== null;
}

export function isToastPortalDismissalRequest(eventDetails: SheetOpenChangeDetails): boolean {
  if (eventDetails.reason !== "outside-press" && eventDetails.reason !== "focus-out") {
    return false;
  }

  if (targetIsInToastPortal(eventDetails.event.target)) {
    return true;
  }

  return (
    "relatedTarget" in eventDetails.event && targetIsInToastPortal(eventDetails.event.relatedTarget)
  );
}
