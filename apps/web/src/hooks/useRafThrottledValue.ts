import { useEffect, useRef, useState } from "react";

/**
 * Caps React updates to one per animation frame while `enabled`.
 * Use for high-frequency streaming text so markdown parsing stays smooth.
 * When disabled, the latest value is returned synchronously with no lag.
 */
export function useRafThrottledValue<T>(value: T, enabled: boolean): T {
  const [displayed, setDisplayed] = useState(value);
  const latestRef = useRef(value);
  const frameRef = useRef<number | null>(null);
  const prevEnabledRef = useRef(enabled);

  latestRef.current = value;

  useEffect(() => {
    if (!enabled) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      prevEnabledRef.current = false;
      setDisplayed(value);
      return;
    }

    if (!prevEnabledRef.current) {
      setDisplayed(value);
    }
    prevEnabledRef.current = true;

    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDisplayed(latestRef.current);
    });
  }, [enabled, value]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return enabled ? displayed : value;
}
