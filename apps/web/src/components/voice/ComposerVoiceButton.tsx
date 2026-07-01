import { useAtomValue } from "@effect/atom-react";
import { MicIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { primaryServerSettingsAtom } from "~/state/server";
import { useVoiceStore } from "~/voice/useVoiceStore";

/**
 * Composer footer button that opens Voice Mode. Hidden unless local
 * speech-to-text is enabled in server settings.
 */
export function ComposerVoiceButton() {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const open = useVoiceStore((state) => state.open);

  if (!settings.speech.sttEnabled) return null;

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
              size="sm"
              type="button"
              onClick={open}
              aria-label="Voice mode"
            />
          }
        >
          <MicIcon />
          <span className="sr-only sm:not-sr-only">Voice</span>
        </TooltipTrigger>
        <TooltipPopup side="top">Voice mode</TooltipPopup>
      </Tooltip>
    </>
  );
}
