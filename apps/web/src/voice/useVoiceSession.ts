/**
 * Voice session orchestrator.
 *
 * Wires the microphone capture, whisper.cpp transcription, prompt submission,
 * and Kokoro TTS playback together for the Voice Mode overlay. Owns the capture
 * and playback controllers, drives the orb via the voice store, handles the
 * three submit triggers (push-to-talk, silence VAD, codeword), and speaks the
 * streaming assistant reply while it prints — skipping code.
 */
import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import {
  detectSendPromptCodeword,
  markdownToSpeakable,
  segmentSpeakable,
} from "@t3tools/shared/speakableText";
import { useCallback, useEffect, useRef } from "react";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import { newMessageId } from "~/lib/utils";
import { useThreadMessages, useThreadSession } from "~/state/entities";
import { primaryServerSettingsAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { resolveThreadRouteTarget } from "~/threadRoutes";

import { VoiceCaptureController } from "./audioCapture";
import { TtsPlaybackController } from "./ttsPlayback";
import { transcribeAudio } from "./sttClient";
import { useVoiceStore } from "./useVoiceStore";

export interface VoiceSessionHandlers {
  readonly startPushToTalk: () => void;
  readonly endPushToTalk: () => void;
}

export function useVoiceSession(): VoiceSessionHandlers {
  const isOpen = useVoiceStore((state) => state.isOpen);
  const mode = useVoiceStore((state) => state.mode);
  const muted = useVoiceStore((state) => state.muted);

  const settings = useAtomValue(primaryServerSettingsAtom);
  const speech = settings.speech;

  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const threadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const session = useThreadSession(threadRef);
  const messages = useThreadMessages(threadRef);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });

  const captureRef = useRef<VoiceCaptureController | null>(null);
  const playbackRef = useRef<TtsPlaybackController | null>(null);

  // Latest values read inside stable callbacks.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const threadRefRef = useRef(threadRef);
  threadRefRef.current = threadRef;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const startTurnRef = useRef(startTurn);
  startTurnRef.current = startTurn;

  const submitPrompt = useCallback(async (text: string) => {
    const ref = threadRefRef.current;
    const trimmed = text.trim();
    if (!ref || trimmed.length === 0) return;
    useVoiceStore.getState().setStatus("thinking");
    await startTurnRef.current({
      environmentId: ref.environmentId,
      input: {
        threadId: ref.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: trimmed,
          attachments: [],
        },
        runtimeMode: sessionRef.current?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
      },
    });
  }, []);

  const handleUtterance = useCallback(
    async (wav: Uint8Array) => {
      const store = useVoiceStore.getState();
      store.setStatus("thinking");
      try {
        const { text } = await transcribeAudio(wav);
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          store.setStatus("listening");
          return;
        }
        const codeword = speechRef.current.sendPromptCodeword || "send prompt";
        const { matched, strippedText } = detectSendPromptCodeword(trimmed, codeword);
        if (matched || modeRef.current === "auto-silence") {
          const toSend = matched ? strippedText : trimmed;
          store.setTranscript(toSend);
          await submitPrompt(toSend);
        } else {
          store.setTranscript(trimmed);
          store.setStatus("listening");
        }
      } catch (error) {
        store.setError(error instanceof Error ? error.message : String(error));
        store.setStatus("listening");
      }
    },
    [submitPrompt],
  );

  // Capture + playback lifecycle, tied to the overlay being open.
  useEffect(() => {
    if (!isOpen) return;
    const store = useVoiceStore.getState();

    const capture = new VoiceCaptureController(
      {
        onLevel: (level) => {
          if (useVoiceStore.getState().status !== "speaking") {
            useVoiceStore.getState().setLevel(level);
          }
        },
        onSpeechStart: () => {
          // Barge-in: stop speaking as soon as the user talks.
          playbackRef.current?.stop();
          if (useVoiceStore.getState().status !== "thinking") {
            useVoiceStore.getState().setStatus("listening");
          }
        },
        onUtteranceEnd: (wav) => {
          void handleUtterance(wav);
        },
        onError: (error) =>
          useVoiceStore.getState().setError(error instanceof Error ? error.message : String(error)),
      },
      { autoEndOnSilence: modeRef.current === "auto-silence" },
    );
    captureRef.current = capture;

    const playback = new TtsPlaybackController({
      onLevel: (level) => useVoiceStore.getState().setLevel(level),
      onPlayingChange: (playing) =>
        useVoiceStore.getState().setStatus(playing ? "speaking" : "listening"),
      getVoice: () => speechRef.current.kokoroVoice || undefined,
    });
    playbackRef.current = playback;

    store.setStatus("idle");
    void capture
      .start()
      .then(() => useVoiceStore.getState().setStatus("listening"))
      .catch(() => undefined);

    return () => {
      void capture.stop();
      void playback.dispose();
      captureRef.current = null;
      playbackRef.current = null;
    };
  }, [isOpen, handleUtterance]);

  useEffect(() => {
    captureRef.current?.setAutoEndOnSilence(mode === "auto-silence");
  }, [mode]);

  useEffect(() => {
    if (muted) playbackRef.current?.stop();
  }, [muted]);

  // Speak the streaming assistant reply while it prints, skipping code. Tracks
  // how many complete sentences have been spoken per assistant message.
  const spokenRef = useRef<{ messageId: string | null; spokenCount: number; done: boolean }>({
    messageId: null,
    spokenCount: 0,
    done: false,
  });

  useEffect(() => {
    if (!isOpen || !speechRef.current.ttsEnabled || useVoiceStore.getState().muted) return;
    const playback = playbackRef.current;
    if (!playback) return;

    let assistant: (typeof messages)[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "assistant") {
        assistant = messages[i];
        break;
      }
    }
    if (!assistant) return;

    const tracker = spokenRef.current;
    if (assistant.id !== tracker.messageId) {
      tracker.messageId = assistant.id;
      tracker.spokenCount = 0;
      tracker.done = false;
    }
    if (tracker.done) return;

    const spoken = markdownToSpeakable(assistant.text);
    const { units, remainder } = segmentSpeakable(spoken);
    for (let i = tracker.spokenCount; i < units.length; i += 1) {
      playback.enqueue(playback.nextIndex(), units[i]!);
    }
    tracker.spokenCount = units.length;

    if (!assistant.streaming) {
      const tail = remainder.trim();
      if (tail.length > 0) playback.enqueue(playback.nextIndex(), tail);
      tracker.done = true;
    }
  }, [messages, isOpen]);

  const startPushToTalk = useCallback(() => {
    playbackRef.current?.stop();
    captureRef.current?.beginForcedUtterance();
    useVoiceStore.getState().setStatus("listening");
  }, []);

  const endPushToTalk = useCallback(() => {
    captureRef.current?.finishUtterance();
  }, []);

  return { startPushToTalk, endPushToTalk };
}
