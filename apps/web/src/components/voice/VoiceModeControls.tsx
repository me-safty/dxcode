import { MicIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import type { VoiceSubmitMode } from "~/voice/useVoiceStore";
import type { VoiceOrbState } from "./VoiceOrb";

interface VoiceModeControlsProps {
  readonly mode: VoiceSubmitMode;
  readonly muted: boolean;
  readonly status: VoiceOrbState;
  readonly onPushStart: () => void;
  readonly onPushEnd: () => void;
  readonly onToggleMode: () => void;
  readonly onToggleMute: () => void;
  readonly onClose: () => void;
}

export function VoiceModeControls({
  mode,
  muted,
  status,
  onPushStart,
  onPushEnd,
  onToggleMode,
  onToggleMute,
  onClose,
}: VoiceModeControlsProps) {
  const isPushToTalk = mode === "push-to-talk";

  return (
    <div className="flex flex-col items-center gap-6">
      <button
        type="button"
        aria-label={isPushToTalk ? "Hold to talk" : "Listening"}
        className={cn(
          "flex size-20 items-center justify-center rounded-full border-2 transition-colors",
          status === "listening"
            ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
            : "border-white/30 bg-white/10 text-white",
          isPushToTalk ? "cursor-pointer active:scale-95" : "cursor-default",
        )}
        onPointerDown={isPushToTalk ? onPushStart : undefined}
        onPointerUp={isPushToTalk ? onPushEnd : undefined}
        onPointerLeave={isPushToTalk ? onPushEnd : undefined}
      >
        <MicIcon className="size-8" />
      </button>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onToggleMode}>
          {isPushToTalk ? "Push to talk" : "Auto (silence)"}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={muted ? "Unmute voice" : "Mute voice"}
          onClick={onToggleMute}
        >
          {muted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
        </Button>
        <Button variant="outline" size="icon" aria-label="Close voice mode" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
