import { create } from "zustand";
import { type MessageId } from "@t3tools/contracts";

/**
 * Tracks which assistant message (if any) is currently being read aloud by
 * the TTS player. Audio playback itself is owned by `useTtsPlayer` (a
 * module-level singleton `<audio>` element); this store only mirrors the
 * status so any number of `MessagePlayButton` instances can render the
 * correct icon without subscribing to a DOM element.
 *
 * Kept separate from the main `useStore` because its lifecycle is
 * independent of orchestration state.
 */

export type AudioPlayerStatus = "idle" | "loading" | "playing";

interface AudioPlayerState {
  status: AudioPlayerStatus;
  playingMessageId: MessageId | null;
  error: string | null;
}

interface AudioPlayerActions {
  setLoading: (id: MessageId) => void;
  setPlaying: (id: MessageId) => void;
  setIdle: () => void;
  setError: (message: string) => void;
}

export const useAudioPlayerStore = create<AudioPlayerState & AudioPlayerActions>((set) => ({
  status: "idle",
  playingMessageId: null,
  error: null,
  setLoading: (id) => set({ status: "loading", playingMessageId: id, error: null }),
  setPlaying: (id) => set({ status: "playing", playingMessageId: id, error: null }),
  setIdle: () => set({ status: "idle", playingMessageId: null }),
  setError: (message) => set({ status: "idle", playingMessageId: null, error: message }),
}));
