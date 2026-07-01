import type { SpeechToTextResult } from "@t3tools/contracts";

import { voiceFetch } from "./voiceHttp";

/** POST a 16 kHz mono WAV utterance and get back its transcript. */
export async function transcribeAudio(
  wav: Uint8Array,
  options?: { readonly language?: string },
): Promise<SpeechToTextResult> {
  const query = options?.language ? `?language=${encodeURIComponent(options.language)}` : "";
  const response = await voiceFetch(`/api/stt/transcribe${query}`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    // Uint8Array is a valid fetch body at runtime; the DOM BodyInit type is
    // over-strict about the backing ArrayBufferLike.
    body: wav as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`Transcription failed (${response.status}).`);
  }
  return (await response.json()) as SpeechToTextResult;
}
