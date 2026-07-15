const VOICE_SAMPLE_RATE = 24_000;
const AUDIO_CHUNK_DURATION_MS = 100;

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

export class VoiceAudioController {
  readonly sampleRate = VOICE_SAMPLE_RATE;

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;
  private playbackSources = new Set<AudioBufferSourceNode>();
  private nextPlaybackAt = 0;
  private muted = false;

  private getAudioContext(): AudioContext {
    if (this.audioContext === null) {
      this.audioContext = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    }
    return this.audioContext;
  }

  async start(onAudioData: (audio: string) => void): Promise<void> {
    const audioContext = this.getAudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: VOICE_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.mediaStream = stream;
    this.setMuted(this.muted);

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    this.sourceNode = source;
    this.processorNode = processor;
    this.silentGainNode = silentGain;

    let buffers: Float32Array[] = [];
    let bufferedSamples = 0;
    const chunkSamples = Math.round((VOICE_SAMPLE_RATE * AUDIO_CHUNK_DURATION_MS) / 1000);

    processor.onaudioprocess = (event) => {
      if (this.muted) return;
      const input = new Float32Array(event.inputBuffer.getChannelData(0));
      buffers.push(input);
      bufferedSamples += input.length;
      while (bufferedSamples >= chunkSamples) {
        const chunk = new Float32Array(chunkSamples);
        let written = 0;
        while (written < chunkSamples) {
          const buffer = buffers[0];
          if (!buffer) break;
          const remaining = chunkSamples - written;
          if (buffer.length <= remaining) {
            chunk.set(buffer, written);
            written += buffer.length;
            bufferedSamples -= buffer.length;
            buffers.shift();
          } else {
            chunk.set(buffer.subarray(0, remaining), written);
            buffers[0] = buffer.subarray(remaining);
            bufferedSamples -= remaining;
            written += remaining;
          }
        }
        onAudioData(float32ToPcm16Base64(chunk));
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.mediaStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  play(encodedAudio: string): void {
    const audioContext = this.getAudioContext();
    const samples = base64Pcm16ToFloat32(encodedAudio);
    const buffer = audioContext.createBuffer(1, samples.length, VOICE_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    const startsAt = Math.max(audioContext.currentTime + 0.02, this.nextPlaybackAt);
    this.nextPlaybackAt = startsAt + buffer.duration;
    this.playbackSources.add(source);
    source.addEventListener("ended", () => {
      this.playbackSources.delete(source);
      source.disconnect();
    });
    source.start(startsAt);
  }

  stopPlayback(): void {
    for (const source of this.playbackSources) {
      try {
        source.stop();
      } catch {
        // A source can already be stopped by Chromium while its ended callback is queued.
      }
      source.disconnect();
    }
    this.playbackSources.clear();
    this.nextPlaybackAt = 0;
  }

  async stop(): Promise<void> {
    this.stopPlayback();
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
    }
    this.sourceNode?.disconnect();
    this.silentGainNode?.disconnect();
    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    this.processorNode = null;
    this.sourceNode = null;
    this.silentGainNode = null;
    this.mediaStream = null;
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}
