import voiceAudioWorkletUrl from "./VoiceAudioProcessor.worklet?worker&url";

const VOICE_SAMPLE_RATE = 24_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

function float32ToPcm16Base64(samples: Float32Array): string {
  const pcm16 = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return bytesToBase64(new Uint8Array(pcm16.buffer));
}

function base64Pcm16ToFloat32(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const samples = new Float32Array(pcm16.length);
  for (let index = 0; index < pcm16.length; index += 1) {
    samples[index] = (pcm16[index] ?? 0) / 0x8000;
  }
  return samples;
}

export interface VoiceAudioDiagnostics {
  readonly inputDevice: string;
  readonly inputSampleRate: number | null;
  readonly inputChannels: number | null;
  readonly contextSampleRate: number;
  readonly baseLatencyMs: number;
  readonly outputLatencyMs: number | null;
}

export class VoiceAudioController {
  readonly sampleRate = VOICE_SAMPLE_RATE;

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private muted = false;

  private getAudioContext(): AudioContext {
    if (this.audioContext === null) {
      this.audioContext = new AudioContext({
        sampleRate: VOICE_SAMPLE_RATE,
        latencyHint: "interactive",
      });
    }
    return this.audioContext;
  }

  async start(onAudioData: (audio: string) => void): Promise<VoiceAudioDiagnostics> {
    const audioContext = this.getAudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    await audioContext.audioWorklet.addModule(voiceAudioWorkletUrl);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: VOICE_SAMPLE_RATE },
        sampleSize: { ideal: 16 },
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.mediaStream = stream;
    this.setMuted(this.muted);

    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, "t3-voice-audio-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    worklet.port.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object" || !("type" in event.data)) return;
      const message = event.data as { readonly type: string; readonly samples?: ArrayBuffer };
      if (message.type === "input" && message.samples) {
        onAudioData(float32ToPcm16Base64(new Float32Array(message.samples)));
      }
    });
    worklet.port.start();
    source.connect(worklet);
    worklet.connect(audioContext.destination);
    this.sourceNode = source;
    this.workletNode = worklet;

    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings();
    return {
      inputDevice: track?.label || "Default microphone",
      inputSampleRate: settings?.sampleRate ?? null,
      inputChannels: settings?.channelCount ?? null,
      contextSampleRate: audioContext.sampleRate,
      baseLatencyMs: Math.round(audioContext.baseLatency * 1_000),
      outputLatencyMs:
        "outputLatency" in audioContext
          ? Math.round(
              (audioContext as AudioContext & { outputLatency: number }).outputLatency * 1_000,
            )
          : null,
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.mediaStream?.getAudioTracks() ?? []) track.enabled = !muted;
    this.workletNode?.port.postMessage({ type: muted ? "muted" : "unmuted" }, []);
  }

  play(encodedAudio: string): void {
    const samples = base64Pcm16ToFloat32(encodedAudio);
    this.workletNode?.port.postMessage({ type: "playback", samples: samples.buffer }, [
      samples.buffer,
    ]);
  }

  flushPlayback(): void {
    this.workletNode?.port.postMessage({ type: "flush-playback" }, []);
  }

  stopPlayback(): void {
    this.workletNode?.port.postMessage({ type: "clear-playback" }, []);
  }

  async stop(): Promise<void> {
    this.stopPlayback();
    this.workletNode?.port.close();
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    for (const track of this.mediaStream?.getTracks() ?? []) track.stop();
    this.workletNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}
