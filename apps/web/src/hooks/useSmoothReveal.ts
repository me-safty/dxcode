import { useCallback, useLayoutEffect, useRef, useState } from "react";

const MS_PER_WORD = 30;
const MIN_DURATION_MS = 600;
const MAX_DURATION_MS = 5000;
const MIN_TEXT_LENGTH = 10;
const MAX_WORD_COUNT = 2000;
const WORD_FADE_MS = 140;
const BURST_FRACTION = 0.05;

const SENTENCE_ENDERS = new Set([".", "!", "?"]);
const CLAUSE_BREAKS = new Set([",", ";", ":", "—", "–"]);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wrapTextNodes(root: HTMLElement): HTMLSpanElement[] {
  const spans: HTMLSpanElement[] = [];
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let cursor: Node | null = walker.nextNode();
  while (cursor) {
    if ((cursor as Text).textContent?.length) textNodes.push(cursor as Text);
    cursor = walker.nextNode();
  }

  for (const tn of textNodes) {
    const raw = tn.textContent ?? "";
    const parts = raw.match(/\S+|\s+/g);
    if (!parts || parts.length === 0) continue;
    if (parts.length === 1 && /^\s+$/.test(parts[0]!)) continue;

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const s = document.createElement("span");
        s.textContent = part;
        s.className = "tr-word";
        spans.push(s);
        frag.appendChild(s);
      }
    }
    tn.parentNode?.replaceChild(frag, tn);
  }

  return spans;
}

function hideDecoratedElements(root: HTMLElement): void {
  for (const li of root.querySelectorAll("li")) {
    li.classList.add("tr-li-hidden");
  }
  for (const el of root.querySelectorAll(
    ".chat-markdown-codeblock, :not(pre) > code, blockquote, table, hr",
  )) {
    el.classList.add("tr-block-hidden");
  }
  for (const input of root.querySelectorAll('input[type="checkbox"]')) {
    (input as HTMLElement).classList.add("tr-input-hidden");
  }
}

function revealDecorationForSpan(span: HTMLSpanElement): void {
  const li = span.closest("li.tr-li-hidden");
  if (li) {
    li.classList.remove("tr-li-hidden");
    const checkbox = li.querySelector(".tr-input-hidden");
    if (checkbox) checkbox.classList.remove("tr-input-hidden");
  }
  const block = span.closest(".tr-block-hidden");
  if (block) block.classList.remove("tr-block-hidden");
}

function unwrapSpans(root: HTMLElement): void {
  for (const el of root.querySelectorAll(".tr-li-hidden")) {
    el.classList.remove("tr-li-hidden");
  }
  for (const el of root.querySelectorAll(".tr-block-hidden")) {
    el.classList.remove("tr-block-hidden");
  }
  for (const el of root.querySelectorAll(".tr-input-hidden")) {
    el.classList.remove("tr-input-hidden");
  }
  const nodes = Array.from(root.querySelectorAll(".tr-word"));
  for (const span of nodes) {
    span.parentNode?.replaceChild(document.createTextNode(span.textContent ?? ""), span);
  }
  root.normalize();
}

function buildTimeline(spans: ReadonlyArray<HTMLSpanElement>): Float64Array {
  const n = spans.length;
  const tl = new Float64Array(n);
  if (n === 0) return tl;

  const total = Math.min(Math.max(n * MS_PER_WORD, MIN_DURATION_MS), MAX_DURATION_MS);
  const base = total / n;
  const burstEnd = Math.floor(n * BURST_FRACTION);
  let cum = 0;

  for (let i = 0; i < n; i++) {
    let dt = base;
    if (i < burstEnd) dt *= 0.25;

    const txt = spans[i]!.textContent ?? "";
    const last = txt[txt.length - 1];
    if (last) {
      if (SENTENCE_ENDERS.has(last)) dt += 100 + Math.random() * 80;
      else if (CLAUSE_BREAKS.has(last)) dt += 35 + Math.random() * 30;
    }

    dt *= 0.7 + Math.random() * 0.6;
    dt = Math.max(dt, 4);
    cum += dt;
    tl[i] = cum;
  }

  const scale = total / cum;
  for (let i = 0; i < n; i++) tl[i]! *= scale;
  return tl;
}

function searchTimeline(tl: Float64Array, t: number): number {
  let lo = 0;
  let hi = tl.length - 1;
  if (hi < 0 || t < tl[0]!) return 0;
  if (t >= tl[hi]!) return tl.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tl[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function useSmoothReveal(
  enabled: boolean,
  textLength: number,
): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isRevealing: boolean;
  finish: () => void;
} {
  const [active] = useState(
    () => enabled && textLength >= MIN_TEXT_LENGTH && !prefersReducedMotion(),
  );
  const [isRevealing, setIsRevealing] = useState(active);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const spansRef = useRef<HTMLSpanElement[]>([]);

  const finish = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    for (const s of spansRef.current) s.classList.add("tr-visible");
    const el = containerRef.current;
    if (el) {
      setTimeout(() => {
        if (el.isConnected) unwrapSpans(el);
        spansRef.current = [];
      }, WORD_FADE_MS + 30);
    }
    setIsRevealing(false);
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) {
      setIsRevealing(false);
      return;
    }

    const spans = wrapTextNodes(el);
    spansRef.current = spans;

    if (spans.length === 0 || spans.length > MAX_WORD_COUNT) {
      unwrapSpans(el);
      spansRef.current = [];
      setIsRevealing(false);
      return;
    }

    hideDecoratedElements(el);

    const burstCount = Math.max(1, Math.floor(spans.length * BURST_FRACTION));
    for (let i = 0; i < burstCount && i < spans.length; i++) {
      spans[i]!.classList.add("tr-visible");
      revealDecorationForSpan(spans[i]!);
    }

    const tl = buildTimeline(spans);
    const start = performance.now();
    let last = burstCount - 1;

    const tick = (now: number) => {
      if (!el.isConnected) {
        rafRef.current = 0;
        spansRef.current = [];
        setIsRevealing(false);
        return;
      }

      const idx = searchTimeline(tl, now - start);

      while (last < idx - 1 && last < spans.length - 1) {
        last++;
        const span = spans[last]!;
        if (!span.isConnected) continue;
        span.classList.add("tr-visible");
        revealDecorationForSpan(span);
      }

      if (idx < spans.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        for (let i = last + 1; i < spans.length; i++) {
          const span = spans[i]!;
          if (span.isConnected) span.classList.add("tr-visible");
        }
        setTimeout(() => {
          if (el.isConnected) {
            unwrapSpans(el);
            spansRef.current = [];
          }
        }, WORD_FADE_MS + 30);
        rafRef.current = 0;
        setIsRevealing(false);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (el.isConnected) unwrapSpans(el);
      spansRef.current = [];
    };
  }, [active]);

  return { containerRef, isRevealing, finish };
}
