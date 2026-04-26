/**
 * Per-message TTS playback button. API mirrors `MessageCopyButton` so it
 * slots in next to it without restyling.
 *
 * Visual states:
 *   idle     → `Volume2Icon`        (label: "Play with TTS")
 *   loading  → `Loader2Icon` spin   (label: "Stop playback")
 *   playing  → `VolumeXIcon`        (label: "Stop playback")
 *
 * Audio ownership lives in `useTtsPlayer` (module-level singleton). This
 * component just reads the shared status from `useAudioPlayerStore` and
 * dispatches play/stop. Errors surface as an anchored toast (same surface
 * as `MessageCopyButton`'s "Copied!" toast).
 */
import { memo, useEffect, useRef } from "react";
import { Loader2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { type MessageId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { anchoredToastManager } from "../ui/toast";
import { cn } from "~/lib/utils";
import { useAudioPlayerStore } from "~/audioPlayerStore";
import { useTtsPlayer } from "~/hooks/useTtsPlayer";

const ERROR_TOAST_TIMEOUT_MS = 4000;

export const MessagePlayButton = memo(function MessagePlayButton({
  messageId,
  text,
  size = "xs",
  variant = "outline",
  className,
}: {
  messageId: MessageId;
  text: string;
  size?: "xs" | "icon-xs";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { play, stop } = useTtsPlayer();
  const status = useAudioPlayerStore((s) => s.status);
  const playingId = useAudioPlayerStore((s) => s.playingMessageId);
  const error = useAudioPlayerStore((s) => s.error);

  const isThis = playingId === messageId;
  const isLoading = isThis && status === "loading";
  const isPlaying = isThis && status === "playing";
  const isActive = isLoading || isPlaying;

  // Surface the most recent error from any play attempt as an anchored toast,
  // but only for the button that triggered it (whichever one currently
  // matches `playingMessageId`). The store clears `error` on the next
  // setLoading/setPlaying/setIdle, so this fires once per failure.
  useEffect(() => {
    if (error === null || !ref.current) return;
    if (playingId !== null && playingId !== messageId) return;
    anchoredToastManager.add({
      data: { tooltipStyle: true },
      positionerProps: { anchor: ref.current },
      timeout: ERROR_TOAST_TIMEOUT_MS,
      title: "TTS playback failed",
      description: error,
    });
  }, [error, messageId, playingId]);

  const Icon = isLoading ? Loader2Icon : isPlaying ? VolumeXIcon : Volume2Icon;
  const label = isActive ? "Stop playback" : "Play with TTS";
  const trimmed = text.trim();

  const handleClick = () => {
    if (isActive) {
      stop();
      return;
    }
    void play(messageId, trimmed).catch(() => {
      // Error already surfaced via the store + effect above.
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={trimmed.length === 0}
            onClick={handleClick}
            ref={ref}
            type="button"
            size={size}
            variant={variant}
            className={cn(className)}
          />
        }
      >
        <Icon className={cn("size-3", isLoading && "animate-spin")} />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
