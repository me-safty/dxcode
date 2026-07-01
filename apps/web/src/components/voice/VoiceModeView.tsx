import { useVoiceSession } from "~/voice/useVoiceSession";
import { useVoiceStore } from "~/voice/useVoiceStore";

import { VoiceModeControls } from "./VoiceModeControls";
import { VoiceOrb } from "./VoiceOrb";

const STATUS_LABEL: Record<string, string> = {
  idle: "Starting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

/**
 * Full-screen, ChatGPT-style Voice Mode overlay: an audio-reactive orb, a live
 * status line, the current transcript, and the mic / mode / mute / close
 * controls. Rendered via a portal from the chat layout, gated on `isOpen`.
 */
export function VoiceModeView() {
  const isOpen = useVoiceStore((state) => state.isOpen);
  const status = useVoiceStore((state) => state.status);
  const level = useVoiceStore((state) => state.level);
  const muted = useVoiceStore((state) => state.muted);
  const mode = useVoiceStore((state) => state.mode);
  const transcript = useVoiceStore((state) => state.transcript);
  const error = useVoiceStore((state) => state.error);
  const close = useVoiceStore((state) => state.close);
  const toggleMuted = useVoiceStore((state) => state.toggleMuted);
  const setMode = useVoiceStore((state) => state.setMode);

  // The session hook is only meaningful while open; it early-returns internally
  // when closed, but we still must call it unconditionally (hook rules).
  const { startPushToTalk, endPushToTalk } = useVoiceSession();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10 bg-background/80 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-3">
        <VoiceOrb level={level} state={status} size={260} />
        <p className="text-lg font-medium text-foreground/90">
          {STATUS_LABEL[status] ?? "Voice mode"}
        </p>
      </div>

      {transcript ? (
        <p className="max-w-xl px-6 text-center text-sm text-muted-foreground">“{transcript}”</p>
      ) : null}

      {error ? <p className="max-w-xl px-6 text-center text-sm text-destructive">{error}</p> : null}

      <VoiceModeControls
        mode={mode}
        muted={muted}
        status={status}
        onPushStart={startPushToTalk}
        onPushEnd={endPushToTalk}
        onToggleMode={() => setMode(mode === "push-to-talk" ? "auto-silence" : "push-to-talk")}
        onToggleMute={toggleMuted}
        onClose={close}
      />
    </div>
  );
}
