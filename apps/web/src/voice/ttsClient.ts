import { voiceFetch } from "./voiceHttp";

/** POST one speakable text unit and get back WAV audio bytes. */
export async function synthesizeSpeech(
  text: string,
  options?: { readonly voice?: string; readonly speed?: number; readonly signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const response = await voiceFetch("/api/tts/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      ...(options?.voice ? { voice: options.voice } : {}),
      ...(options?.speed !== undefined ? { speed: options.speed } : {}),
    }),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Speech synthesis failed (${response.status}).`);
  }
  return await response.arrayBuffer();
}
