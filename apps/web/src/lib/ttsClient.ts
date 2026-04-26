/**
 * Thin fetch wrapper for the local Kokoro-FastAPI server's OpenAI-compatible
 * TTS endpoint. Pure: no React, no store coupling, no logging side-effects.
 *
 * The server is expected to be reachable at `serverUrl` (loopback by default).
 * See ~/projects/Kokoro-FastAPI for the reference implementation.
 */

export type TtsRequest = {
  text: string;
  voice: string;
  serverUrl: string;
  signal?: AbortSignal | undefined;
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

export async function synthesizeSpeech(req: TtsRequest): Promise<Blob> {
  const endpoint = `${stripTrailingSlash(req.serverUrl)}/v1/audio/speech`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "kokoro",
      input: req.text,
      voice: req.voice,
      response_format: "wav",
    }),
  };
  if (req.signal !== undefined) {
    init.signal = req.signal;
  }
  const res = await fetch(endpoint, init);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TtsServerError(res.status, res.statusText, detail);
  }

  return await res.blob();
}

export class TtsServerError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly detail: string;

  constructor(status: number, statusText: string, detail: string) {
    const trimmedDetail = detail.trim();
    const suffix = trimmedDetail.length > 0 ? `: ${trimmedDetail}` : "";
    super(`TTS server returned ${status} ${statusText}${suffix}`);
    this.name = "TtsServerError";
    this.status = status;
    this.statusText = statusText;
    this.detail = trimmedDetail;
  }
}
