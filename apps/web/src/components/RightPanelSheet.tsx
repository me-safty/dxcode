import { type ComponentProps, type ReactNode } from "react";

import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

const TOAST_PORTAL_SELECTOR = '[data-slot="toast-portal"], [data-slot="toast-portal-anchored"]';

type SheetOpenChangeDetails = Parameters<
  NonNullable<ComponentProps<typeof Sheet>["onOpenChange"]>
>[1];

function targetIsInToastPortal(target: EventTarget | null | undefined): boolean {
  return target instanceof Element && target.closest(TOAST_PORTAL_SELECTOR) !== null;
}

function isToastPortalDismissalRequest(eventDetails: SheetOpenChangeDetails): boolean {
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

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      modal={false}
      open={props.open}
      onOpenChange={(open, eventDetails) => {
        if (!open) {
          if (isToastPortalDismissalRequest(eventDetails)) {
            eventDetails.cancel();
            return;
          }

          props.onClose();
        }
      }}
    >
      <SheetPopup
        allowOutsidePointerEvents
        data-right-panel-sheet="true"
        side="right"
        showCloseButton={false}
        showBackdrop={false}
        keepMounted
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
      >
        <div className="flex h-full min-h-0 w-full flex-col max-[760px]:pb-safe max-[760px]:pr-safe max-[760px]:pt-safe">
          {props.children}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
