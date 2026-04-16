export const COMPLETION_SOUND_OPTIONS = [
  "chime",
  "ping",
  "bell",
  "synth",
  "xylophone",
  "t3",
  "t3-voice",
  "celebration",
  "arcade",
  "bubble",
  "cosmic",
] as const;

export type CompletionSound = (typeof COMPLETION_SOUND_OPTIONS)[number];

export const COMPLETION_SOUND_LABELS: Record<CompletionSound, string> = {
  chime: "Chime",
  ping: "Ping",
  bell: "Bell",
  synth: "Synth",
  xylophone: "Xylophone",
  t3: "T3 Code",
  "t3-voice": 'T3 Code (Voice)',
  celebration: "Celebration",
  arcade: "Arcade",
  bubble: "Bubble Pop",
  cosmic: "Cosmic",
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// ── Original sounds ─────────────────────────────────────────────

/** Rising two-tone chime (A5 → D6) */
function playChime(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(880, now);
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc1.connect(gain1).connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.15);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(1174.66, now + 0.1);
  gain2.gain.setValueAtTime(0.12, now + 0.1);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc2.connect(gain2).connect(ctx.destination);
  osc2.start(now + 0.1);
  osc2.stop(now + 0.3);
}

/** Short, crisp single-tone ping */
function playPing(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

/** Warm bell with harmonics */
function playBell(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const fundamental = 660;

  const harmonics = [1, 2, 3, 4.2];
  const gains = [0.14, 0.06, 0.03, 0.015];
  const decays = [0.6, 0.4, 0.3, 0.2];

  for (let i = 0; i < harmonics.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fundamental * harmonics[i]!, now);
    gain.gain.setValueAtTime(gains[i]!, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decays[i]!);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + decays[i]!);
  }
}

/** Soft synth pad sweep */
function playSynth(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "triangle";
  osc1.frequency.setValueAtTime(440, now);
  osc1.frequency.linearRampToValueAtTime(880, now + 0.2);

  osc2.type = "sine";
  osc2.frequency.setValueAtTime(554.37, now);
  osc2.frequency.linearRampToValueAtTime(1108.73, now + 0.2);

  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc1.connect(gain).connect(ctx.destination);
  osc2.connect(gain);
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.4);
  osc2.stop(now + 0.4);
}

/** Bright three-note xylophone arpeggio */
function playXylophone(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const notes = [1046.5, 1318.51, 1567.98]; // C6, E6, G6
  const spacing = 0.08;

  for (let i = 0; i < notes.length; i++) {
    const t = now + i * spacing;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(notes[i]!, t);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

// ── Playful sounds ──────────────────────────────────────────────

/**
 * T3 Code signature jingle — a bouncy 5-note melody
 * spelling out "T-3-C-O-D-E~" with a playful rhythm
 */
function playT3(ctx: AudioContext): void {
  const now = ctx.currentTime;
  //        T     3     C     O     D     E~
  const notes = [523.25, 659.25, 783.99, 1046.5, 1174.66, 1567.98];
  const times = [0, 0.08, 0.16, 0.28, 0.36, 0.44];
  const durations = [0.1, 0.1, 0.14, 0.1, 0.1, 0.35];
  const volumes = [0.14, 0.12, 0.13, 0.15, 0.13, 0.11];
  const types: OscillatorType[] = ["triangle", "triangle", "sine", "sine", "sine", "sine"];

  for (let i = 0; i < notes.length; i++) {
    const t = now + times[i]!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = types[i]!;
    osc.frequency.setValueAtTime(notes[i]!, t);
    // Last note gets a gentle vibrato for the "~" tail
    if (i === notes.length - 1) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(6, t);
      lfoGain.gain.setValueAtTime(8, t);
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + durations[i]!);
    }
    gain.gain.setValueAtTime(volumes[i]!, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durations[i]!);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durations[i]!);
  }
}

/** Celebration fanfare — triumphant major chord arpeggio with sparkle */
function playCelebration(ctx: AudioContext): void {
  const now = ctx.currentTime;
  // C major arpeggio rising into a shimmery high chord
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  const spacing = 0.06;

  for (let i = 0; i < notes.length; i++) {
    const t = now + i * spacing;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i < 3 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(notes[i]!, t);
    const vol = 0.1 + (i * 0.01);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.setValueAtTime(vol, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // Sparkle shimmer at the end
  const sparkleStart = now + notes.length * spacing;
  for (let i = 0; i < 3; i++) {
    const t = sparkleStart + i * 0.04;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2600 + i * 400, t);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

/** Arcade level-up — retro game power-up sound */
function playArcade(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  // Rapid ascending pitch sweep
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.08);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.14);
  osc.frequency.exponentialRampToValueAtTime(1400, now + 0.2);
  osc.frequency.setValueAtTime(1400, now + 0.22);
  osc.frequency.exponentialRampToValueAtTime(1800, now + 0.3);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.setValueAtTime(0.08, now + 0.25);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);

  // Final "ding" on top
  const ding = ctx.createOscillator();
  const dingGain = ctx.createGain();
  ding.type = "sine";
  ding.frequency.setValueAtTime(2200, now + 0.3);
  dingGain.gain.setValueAtTime(0.12, now + 0.3);
  dingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  ding.connect(dingGain).connect(ctx.destination);
  ding.start(now + 0.3);
  ding.stop(now + 0.55);
}

/** Bubble pop — soft bubbly plop sound */
function playBubble(ctx: AudioContext): void {
  const now = ctx.currentTime;

  // Three bubbles rising and popping
  const pops = [
    { freq: 400, time: 0, size: 0.14 },
    { freq: 600, time: 0.1, size: 0.12 },
    { freq: 900, time: 0.18, size: 0.15 },
  ];

  for (const pop of pops) {
    const t = now + pop.time;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // Quick pitch drop = "pop" feel
    osc.frequency.setValueAtTime(pop.freq * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(pop.freq, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(pop.freq * 0.6, t + 0.12);
    gain.gain.setValueAtTime(pop.size, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }
}

/** Cosmic — spacey warp completion with reverb-like tail */
function playCosmic(ctx: AudioContext): void {
  const now = ctx.currentTime;

  // Sweep upward
  const sweep = ctx.createOscillator();
  const sweepGain = ctx.createGain();
  sweep.type = "sine";
  sweep.frequency.setValueAtTime(200, now);
  sweep.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
  sweep.frequency.exponentialRampToValueAtTime(800, now + 0.5);
  sweepGain.gain.setValueAtTime(0.1, now);
  sweepGain.gain.setValueAtTime(0.12, now + 0.15);
  sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  sweep.connect(sweepGain).connect(ctx.destination);
  sweep.start(now);
  sweep.stop(now + 0.6);

  // Shimmer harmonics
  const harmonicFreqs = [1600, 2000, 2400];
  for (let i = 0; i < harmonicFreqs.length; i++) {
    const t = now + 0.15 + i * 0.05;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(harmonicFreqs[i]!, t);
    osc.frequency.linearRampToValueAtTime(harmonicFreqs[i]! * 0.85, t + 0.4);
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  // Sub bass thump
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = "sine";
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(40, now + 0.2);
  subGain.gain.setValueAtTime(0.12, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  sub.connect(subGain).connect(ctx.destination);
  sub.start(now);
  sub.stop(now + 0.2);
}

/**
 * T3 Code spoken voice — uses Speech Synthesis API to say "T3 Code"
 * with a subtle chime underneath for polish
 */
function playT3Voice(ctx: AudioContext): void {
  try {
    if ("speechSynthesis" in window) {
      // Cancel any ongoing speech
      speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance("T 3 Code");
      utterance.rate = 1.0;
      utterance.pitch = 1.2;
      utterance.volume = 0.8;

      // Try to pick a good voice — prefer English female voices for a friendly feel
      const voices = speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          (v.name.includes("Samantha") || // macOS
            v.name.includes("Karen") || // macOS
            v.name.includes("Google UK English Female") || // Chrome
            v.name.includes("Microsoft Zira")), // Windows
      );
      const englishFallback = voices.find((v) => v.lang.startsWith("en"));
      if (preferred) {
        utterance.voice = preferred;
      } else if (englishFallback) {
        utterance.voice = englishFallback;
      }

      speechSynthesis.speak(utterance);
    }
  } catch {
    // Speech synthesis not available — fall back silently
  }

  // Subtle chime underneath the voice
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1046.5, now);
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

// ── Registry ────────────────────────────────────────────────────

const SOUND_PLAYERS: Record<CompletionSound, (ctx: AudioContext) => void> = {
  chime: playChime,
  ping: playPing,
  bell: playBell,
  synth: playSynth,
  xylophone: playXylophone,
  t3: playT3,
  "t3-voice": playT3Voice,
  celebration: playCelebration,
  arcade: playArcade,
  bubble: playBubble,
  cosmic: playCosmic,
};

/**
 * Plays the specified completion sound.
 * Fails silently if audio is unavailable (e.g. autoplay policy not yet unlocked).
 */
export function playTurnCompletionSound(sound: CompletionSound = "chime"): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    SOUND_PLAYERS[sound](ctx);
  } catch {
    // Silently fail — audio is best-effort
  }
}
