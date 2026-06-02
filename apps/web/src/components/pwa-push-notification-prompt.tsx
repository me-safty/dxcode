import { LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isStandalonePwa } from "../env";
import {
  enablePushNotifications,
  getBrowserPushSupport,
  getCurrentPushSubscription,
  getNotificationPermission,
} from "../push/notifications";
import {
  isPwaPushPromptHandled,
  markPwaPushPromptHandled,
  shouldOfferPwaPushPrompt,
} from "../push/pwa-push-prompt";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { stackedThreadToast, toastManager } from "./ui/toast";

let pwaPushPromptEligibilityChecked = false;

export function PwaPushNotificationPrompt() {
  const support = useMemo(() => getBrowserPushSupport(), []);
  const [open, setOpen] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

  useEffect(() => {
    if (pwaPushPromptEligibilityChecked) {
      return;
    }
    pwaPushPromptEligibilityChecked = true;

    const permission = getNotificationPermission();
    const promptHandled = isPwaPushPromptHandled();
    const syncEligible = shouldOfferPwaPushPrompt({
      isStandalonePwa: isStandalonePwa(),
      pushSupported: support.supported,
      permission,
      isSubscribed: false,
      promptHandled,
    });

    if (!syncEligible) {
      return;
    }

    void (async () => {
      try {
        const subscription = await getCurrentPushSubscription();
        if (subscription !== null) {
          markPwaPushPromptHandled();
          return;
        }
        setOpen(true);
      } catch {
        // If subscription status cannot be determined, skip the prompt.
      }
    })();
  }, [support.supported]);

  const handleDismiss = useCallback(() => {
    markPwaPushPromptHandled();
    setOpen(false);
  }, []);

  const handleEnable = useCallback(() => {
    setIsEnabling(true);
    void (async () => {
      try {
        await enablePushNotifications();
        markPwaPushPromptHandled();
        setOpen(false);
        toastManager.add({
          type: "success",
          title: "Push notifications enabled",
          description: "This browser is subscribed to server notifications.",
        });
      } catch (error) {
        markPwaPushPromptHandled();
        setOpen(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Push notification update failed",
            description: error instanceof Error ? error.message : "Unable to update notifications.",
          }),
        );
      } finally {
        setIsEnabling(false);
      }
    })();
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isEnabling) {
          return;
        }
        if (!nextOpen) {
          handleDismiss();
        }
      }}
    >
      <DialogPopup className="max-w-lg" showCloseButton={!isEnabling}>
        <DialogHeader>
          <DialogTitle>Enable push notifications?</DialogTitle>
          <DialogDescription>
            Get alerts when an agent needs approval or input, or when a turn completes. This is
            especially useful when the app is in the background on mobile.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={isEnabling} onClick={handleDismiss}>
            Not now
          </Button>
          <Button disabled={isEnabling} onClick={handleEnable}>
            {isEnabling ? <LoaderIcon className="size-4 animate-spin" /> : "Enable notifications"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
