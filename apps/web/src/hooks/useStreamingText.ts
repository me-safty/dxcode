import { useEffect, useRef, useState } from "react";

/**
 * Smoothly reveals streaming text by buffering incoming content and
 * advancing the visible portion incrementally via requestAnimationFrame.
 *
 * When `isStreaming` is false the full text is returned immediately.
 *
 * The revealed position is initialised to the current text length so that
 * on component (re-)mount (e.g. virtual-scroll recycle) all existing text
 * appears instantly — only characters arriving *after* mount are animated.
 *
 * To avoid flickering from partially-parsed markdown, the reveal position
 * snaps forward to the next newline boundary when one is within reach.
 */
export function useStreamingText(targetText: string, isStreaming: boolean): string {
  // Track the number of characters we have revealed so far.
  // Initialised to full length so existing text is shown on mount.
  const revealedRef = useRef(targetText.length);
  const targetRef = useRef(targetText);
  const streamingRef = useRef(isStreaming);
  // A simple counter to trigger React re-renders without holding a copy of
  // the (potentially large) displayed text in state.
  const [, rerender] = useState(0);

  targetRef.current = targetText;
  streamingRef.current = isStreaming;

  // ── Snap to full text when streaming ends ─────────────────────────
  useEffect(() => {
    if (!isStreaming) {
      revealedRef.current = targetText.length;
    }
  }, [isStreaming, targetText]);

  // ── RAF animation loop — runs only while streaming ────────────────
  useEffect(() => {
    if (!isStreaming) return;

    let rafId = 0;
    let active = true;

    const loop = () => {
      if (!active) return;
      const target = targetRef.current;
      let current = revealedRef.current;

      // If the server replaced (rather than appended to) the text, clamp.
      if (current > target.length) {
        current = target.length;
        revealedRef.current = current;
      }

      if (current < target.length) {
        const backlog = target.length - current;
        // Adaptive speed: reveal ~35% of the remaining backlog per frame.
        // This creates a natural ease-out that stays ahead of the 100ms
        // server throttle cadence while keeping the flow visually smooth.
        let nextPos = current + Math.max(2, Math.ceil(backlog * 0.35));
        nextPos = Math.min(nextPos, target.length);

        // Snap forward to the next newline if one is within ~40 chars to
        // avoid splitting a markdown line mid-syntax (which would cause
        // ReactMarkdown to briefly render broken formatting).
        const nextNewline = target.indexOf("\n", nextPos);
        if (nextNewline !== -1 && nextNewline - nextPos < 40) {
          nextPos = nextNewline + 1;
        }

        revealedRef.current = Math.min(nextPos, target.length);
        rerender((c) => c + 1);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
    // Only restart the loop when the streaming flag changes. Incoming text
    // updates are picked up via `targetRef` inside the loop.
  }, [isStreaming]);

  if (!isStreaming) return targetText;
  return targetText.slice(0, revealedRef.current);
}
