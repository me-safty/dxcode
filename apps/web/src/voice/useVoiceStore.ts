import { create } from "zustand";

import type { VoiceOrbState } from "~/components/voice/VoiceOrb";

export type VoiceSubmitMode = "push-to-talk" | "auto-silence";

interface VoiceStoreState {
  /** Whether the full-screen voice overlay is open. */
  isOpen: boolean;
  /** How an utterance is submitted while listening. */
  mode: VoiceSubmitMode;
  /** Visual/logical state driving the orb. */
  status: VoiceOrbState;
  /** Smoothed 0..1 audio level for the orb. */
  level: number;
  /** When true, TTS playback is silenced. */
  muted: boolean;
  /** Latest transcript text shown in the overlay. */
  transcript: string;
  /** Last error message, if any. */
  error: string | null;

  open: () => void;
  close: () => void;
  setMode: (mode: VoiceSubmitMode) => void;
  setStatus: (status: VoiceOrbState) => void;
  setLevel: (level: number) => void;
  toggleMuted: () => void;
  setMuted: (muted: boolean) => void;
  setTranscript: (transcript: string) => void;
  setError: (error: string | null) => void;
}

export const useVoiceStore = create<VoiceStoreState>((set) => ({
  isOpen: false,
  mode: "push-to-talk",
  status: "idle",
  level: 0,
  muted: false,
  transcript: "",
  error: null,

  open: () => set({ isOpen: true, status: "idle", error: null }),
  close: () => set({ isOpen: false, status: "idle", level: 0, transcript: "" }),
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setLevel: (level) => set({ level }),
  toggleMuted: () => set((state) => ({ muted: !state.muted })),
  setMuted: (muted) => set({ muted }),
  setTranscript: (transcript) => set({ transcript }),
  setError: (error) => set({ error }),
}));
