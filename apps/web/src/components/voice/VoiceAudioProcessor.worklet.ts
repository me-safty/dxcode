declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new () => {
    readonly port: MessagePort;
    process(
      inputs: readonly (readonly Float32Array[])[],
      outputs: readonly (readonly Float32Array[])[],
    ): boolean;
  },
): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const INPUT_CHUNK_DURATION_MS = 40;
const PLAYBACK_PREBUFFER_DURATION_MS = 20;

class VoiceAudioProcessor extends AudioWorkletProcessor {
  private readonly inputChunkSamples = Math.round((sampleRate * INPUT_CHUNK_DURATION_MS) / 1_000);
  private readonly playbackPrebufferSamples = Math.round(
    (sampleRate * PLAYBACK_PREBUFFER_DURATION_MS) / 1_000,
  );
  private readonly inputQueue: Float32Array[] = [];
  private inputQueuedSamples = 0;
  private readonly playbackQueue: Float32Array[] = [];
  private playbackQueuedSamples = 0;
  private playbackOffset = 0;
  private playbackStarted = false;
  private muted = false;

  constructor() {
    super();
    this.port.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object" || !("type" in event.data)) return;
      const message = event.data as { readonly type: string; readonly samples?: ArrayBuffer };
      switch (message.type) {
        case "playback": {
          if (!message.samples) return;
          const samples = new Float32Array(message.samples);
          this.playbackQueue.push(samples);
          this.playbackQueuedSamples += samples.length;
          if (this.playbackQueuedSamples >= this.playbackPrebufferSamples) {
            this.playbackStarted = true;
          }
          break;
        }
        case "flush-playback":
          if (this.playbackQueuedSamples > 0) this.playbackStarted = true;
          break;
        case "clear-playback":
          this.playbackQueue.length = 0;
          this.playbackQueuedSamples = 0;
          this.playbackOffset = 0;
          this.playbackStarted = false;
          break;
        case "muted":
          this.muted = true;
          break;
        case "unmuted":
          this.muted = false;
          break;
      }
    });
    this.port.start();
  }

  private captureInput(input: Float32Array | undefined): void {
    if (this.muted || !input || input.length === 0) return;
    const copy = new Float32Array(input);
    this.inputQueue.push(copy);
    this.inputQueuedSamples += copy.length;
    while (this.inputQueuedSamples >= this.inputChunkSamples) {
      const chunk = new Float32Array(this.inputChunkSamples);
      let written = 0;
      while (written < chunk.length) {
        const next = this.inputQueue[0];
        if (!next) break;
        const count = Math.min(next.length, chunk.length - written);
        chunk.set(next.subarray(0, count), written);
        written += count;
        this.inputQueuedSamples -= count;
        if (count === next.length) {
          this.inputQueue.shift();
        } else {
          this.inputQueue[0] = next.subarray(count);
        }
      }
      this.port.postMessage({ type: "input", samples: chunk.buffer }, [chunk.buffer]);
    }
  }

  private renderPlayback(output: Float32Array | undefined): void {
    if (!output) return;
    output.fill(0);
    if (!this.playbackStarted) return;
    let written = 0;
    while (written < output.length) {
      const next = this.playbackQueue[0];
      if (!next) {
        this.playbackStarted = false;
        break;
      }
      const available = next.length - this.playbackOffset;
      const count = Math.min(available, output.length - written);
      output.set(next.subarray(this.playbackOffset, this.playbackOffset + count), written);
      written += count;
      this.playbackOffset += count;
      this.playbackQueuedSamples -= count;
      if (this.playbackOffset === next.length) {
        this.playbackQueue.shift();
        this.playbackOffset = 0;
      }
    }
  }

  process(
    inputs: readonly (readonly Float32Array[])[],
    outputs: readonly (readonly Float32Array[])[],
  ): boolean {
    this.captureInput(inputs[0]?.[0]);
    this.renderPlayback(outputs[0]?.[0]);
    return true;
  }
}

registerProcessor("t3-voice-audio-processor", VoiceAudioProcessor);
