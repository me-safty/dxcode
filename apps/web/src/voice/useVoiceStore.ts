import { create } from "zustand";

const TTS_MUTED_KEY = "t3.voice.ttsMuted";

function readTtsMuted(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(TTS_MUTED_KEY);
    return raw === null || raw === undefined ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeTtsMuted(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(TTS_MUTED_KEY, value ? "true" : "false");
  } catch {
    // ignore persistence failures (private mode, etc.)
  }
}

interface VoiceStoreState {
  /** Whether the composer is actively capturing/dictating. */
  recording: boolean;
  /** When true, assistant replies are not spoken automatically. Persisted. */
  ttsMuted: boolean;
  /** Last error message, if any. */
  error: string | null;

  setRecording: (recording: boolean) => void;
  toggleRecording: () => void;
  setTtsMuted: (muted: boolean) => void;
  toggleTtsMuted: () => void;
  setError: (error: string | null) => void;
}

export const useVoiceStore = create<VoiceStoreState>((set) => ({
  recording: false,
  ttsMuted: readTtsMuted(),
  error: null,

  setRecording: (recording) => set(recording ? { recording, error: null } : { recording }),
  toggleRecording: () => set((state) => ({ recording: !state.recording, error: null })),
  setTtsMuted: (ttsMuted) => {
    writeTtsMuted(ttsMuted);
    set({ ttsMuted });
  },
  toggleTtsMuted: () =>
    set((state) => {
      const ttsMuted = !state.ttsMuted;
      writeTtsMuted(ttsMuted);
      return { ttsMuted };
    }),
  setError: (error) => set({ error }),
}));
