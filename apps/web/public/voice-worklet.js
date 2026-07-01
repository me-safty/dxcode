/**
 * Voice capture AudioWorklet.
 *
 * Downsamples the mic input to 16 kHz mono and posts Int16 PCM frames to the
 * main thread, along with a per-frame RMS level used for a lightweight,
 * dependency-free voice-activity (silence) detector. whisper.cpp wants 16 kHz
 * mono PCM, so producing it here avoids any server-side resampling.
 */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    // `sampleRate` is a global available inside the worklet scope.
    this.ratio = sampleRate / this.targetRate;
    this.carry = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    // Simple linear-interpolation downsampler from `sampleRate` to 16 kHz.
    const outLength = Math.floor((channel.length - this.carry) / this.ratio) + 1;
    const out = new Int16Array(Math.max(0, outLength));
    let outIndex = 0;
    let sumSquares = 0;
    let position = this.carry;
    while (position < channel.length && outIndex < out.length) {
      const index = Math.floor(position);
      const frac = position - index;
      const sample = channel[index] * (1 - frac) + (channel[index + 1] ?? channel[index]) * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      out[outIndex] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      sumSquares += clamped * clamped;
      outIndex += 1;
      position += this.ratio;
    }
    this.carry = position - channel.length;

    if (outIndex > 0) {
      const rms = Math.sqrt(sumSquares / outIndex);
      const frame = out.subarray(0, outIndex);
      this.port.postMessage({ pcm: frame, rms }, [frame.buffer]);
    }

    return true;
  }
}

registerProcessor("voice-capture-processor", VoiceCaptureProcessor);
