import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

interface VoiceOrbProps {
  /** Current audio amplitude, 0..1 — drives the pulse. */
  readonly level: number;
  readonly state: VoiceOrbState;
  readonly className?: string;
  readonly size?: number;
}

const STATE_COLORS: Record<VoiceOrbState, readonly [string, string]> = {
  // [inner, outer] gradient stops.
  idle: ["#6366f1", "#3b82f6"],
  listening: ["#22c55e", "#14b8a6"],
  thinking: ["#f59e0b", "#ec4899"],
  speaking: ["#3b82f6", "#8b5cf6"],
};

/**
 * A ChatGPT-voice-mode-style animated orb rendered on a canvas. It breathes on
 * its own and pulses with the live audio `level`; color and motion follow the
 * conversation `state`. Uses `requestAnimationFrame` and stops when unmounted.
 */
export function VoiceOrb({ level, state, className, size = 240 }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Latest inputs, read inside the animation loop without re-subscribing.
  const levelRef = useRef(level);
  const stateRef = useRef(state);
  levelRef.current = level;
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const center = size / 2;
    const baseRadius = size * 0.28;
    let raf = 0;
    let start = 0;
    let displayLevel = 0;

    const draw = (time: number) => {
      if (start === 0) start = time;
      const elapsed = (time - start) / 1000;

      // Smooth the amplitude so the orb doesn't jitter.
      displayLevel += (levelRef.current - displayLevel) * 0.15;
      const breathe = 0.5 + 0.5 * Math.sin(elapsed * 1.6);
      const [inner, outer] = STATE_COLORS[stateRef.current];
      const pulse = baseRadius * (1 + displayLevel * 0.6 + breathe * 0.06);

      ctx.clearRect(0, 0, size, size);

      // Outer glow.
      const glow = ctx.createRadialGradient(center, center, pulse * 0.2, center, center, pulse * 1.9);
      glow.addColorStop(0, `${outer}55`);
      glow.addColorStop(1, "#00000000");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(center, center, pulse * 1.9, 0, Math.PI * 2);
      ctx.fill();

      // Core orb.
      const core = ctx.createRadialGradient(
        center - pulse * 0.3,
        center - pulse * 0.3,
        pulse * 0.1,
        center,
        center,
        pulse,
      );
      core.addColorStop(0, inner);
      core.addColorStop(1, outer);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(center, center, pulse, 0, Math.PI * 2);
      ctx.fill();

      // Rotating highlight ring for a bit of life.
      ctx.strokeStyle = "#ffffff33";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const ringR = pulse * 1.12;
      const sweep = 1.2 + displayLevel * 2;
      ctx.arc(center, center, ringR, elapsed * 1.5, elapsed * 1.5 + sweep);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("select-none", className)}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
