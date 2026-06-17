import { useClerk } from "@clerk/react";
import { useState } from "react";

import { isElectron } from "../../env";
import { Dialog, DialogPopup } from "../ui/dialog";
import { DesktopClerkWaitlist } from "./DesktopClerkWaitlist";

export function useT3ConnectAuthPrompt() {
  const clerk = useClerk();
  const [desktopAuthOpen, setDesktopAuthOpen] = useState(false);

  const openAuthPrompt = () => {
    if (isElectron) {
      setDesktopAuthOpen(true);
      return;
    }
    clerk.openWaitlist({
      appearance: {
        elements: {
          rootBox: "outline-none",
          cardBox: "outline-none",
          card: "outline-none",
        },
      },
    });
  };

  const authPrompt = isElectron ? (
    <Dialog open={desktopAuthOpen} onOpenChange={setDesktopAuthOpen}>
      <DialogPopup
        className="max-w-[25rem] border-0 bg-transparent shadow-none outline-none before:hidden"
        showCloseButton={false}
      >
        <DesktopClerkWaitlist />
      </DialogPopup>
    </Dialog>
  ) : null;

  return { authPrompt, openAuthPrompt };
}
