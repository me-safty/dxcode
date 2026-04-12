import { deriveDisplayedUserMessageState } from "../lib/terminalContext";
import { buildInlineTerminalContextText } from "./chat/userMessageTerminalContexts";

const ASSISTANT_CHARS_PER_LINE_FALLBACK = 72;
const USER_CHARS_PER_LINE_FALLBACK = 56;
const USER_LINE_HEIGHT_PX = 22;
const ASSISTANT_LINE_HEIGHT_PX = 22.75;
// Assistant rows render as markdown content plus a compact timestamp meta line.
// The DOM baseline is much smaller than the user bubble chrome, so model it
// separately instead of reusing the old shared constant.
const ASSISTANT_BASE_HEIGHT_PX = 41;
const USER_BASE_HEIGHT_PX = 96;
const ATTACHMENTS_PER_ROW = 2;
// Full-app browser measurements land closer to a ~116px attachment row once
// the bubble shrinks to content width, so calibrate the estimate to that DOM.
const USER_ATTACHMENT_ROW_HEIGHT_PX = 116;
const USER_BUBBLE_WIDTH_RATIO = 0.8;
const USER_BUBBLE_HORIZONTAL_PADDING_PX = 32;
const ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX = 8;
const USER_MONO_AVG_CHAR_WIDTH_PX = 6.7;
const ASSISTANT_AVG_CHAR_WIDTH_PX = 7.2;
const MIN_USER_CHARS_PER_LINE = 4;
const MIN_ASSISTANT_CHARS_PER_LINE = 20;
const ASSISTANT_INLINE_CODE_WIDTH_MULTIPLIER = 1.2;
const ASSISTANT_INLINE_CODE_WRAP_OVERHEAD_CHARS = 2;
const INLINE_CODE_SPAN_REGEX = /`([^`\n]+)`/g;
const USER_MESSAGE_BUBBLE_PROBE_CLASS =
  "relative rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3";
const USER_MESSAGE_TEXT_PROBE_CLASS =
  "whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground";
const USER_MESSAGE_META_PROBE_CLASS = "mt-1.5 flex items-center justify-end gap-2";
const USER_MESSAGE_TIMESTAMP_PROBE_CLASS = "text-right text-xs text-muted-foreground/50";
const USER_MESSAGE_CHAR_WIDTH_SAMPLE = "x".repeat(512);

interface TimelineMessageHeightInput {
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ReadonlyArray<{ id: string }>;
}

interface TimelineHeightEstimateLayout {
  timelineWidthPx: number | null;
}

interface BrowserUserMessageMetrics {
  avgCharWidthPx: number;
  baseHeightPx: number;
  bubbleHorizontalChromePx: number;
  lineHeightPx: number;
}

interface BrowserUserMessageProbe {
  host: HTMLDivElement;
  bubble: HTMLDivElement;
  text: HTMLDivElement;
  meta: HTMLDivElement;
  timestamp: HTMLParagraphElement;
  widthSample: HTMLSpanElement;
}

let browserUserMessageProbe: BrowserUserMessageProbe | null = null;
let cachedBrowserUserMessageMetrics: BrowserUserMessageMetrics | null = null;

function canUseBrowserTypographyProbe(): boolean {
  return typeof document !== "undefined" && document.body instanceof HTMLBodyElement;
}

function createBrowserUserMessageProbe(): BrowserUserMessageProbe | null {
  if (!canUseBrowserTypographyProbe()) {
    return null;
  }

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "1200px";
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
  host.style.contain = "layout style";

  const bubble = document.createElement("div");
  bubble.className = USER_MESSAGE_BUBBLE_PROBE_CLASS;
  bubble.style.maxWidth = "80%";

  const text = document.createElement("div");
  text.className = USER_MESSAGE_TEXT_PROBE_CLASS;

  const meta = document.createElement("div");
  meta.className = USER_MESSAGE_META_PROBE_CLASS;

  const timestamp = document.createElement("p");
  timestamp.className = USER_MESSAGE_TIMESTAMP_PROBE_CLASS;
  timestamp.textContent = "12:00 PM";

  const widthSample = document.createElement("span");
  widthSample.className = USER_MESSAGE_TEXT_PROBE_CLASS;
  widthSample.style.display = "inline-block";
  widthSample.style.whiteSpace = "pre";
  widthSample.textContent = USER_MESSAGE_CHAR_WIDTH_SAMPLE;

  meta.append(timestamp);
  bubble.append(text, meta, widthSample);
  host.append(bubble);
  document.body.append(host);

  return { host, bubble, text, meta, timestamp, widthSample };
}

function shouldCacheBrowserUserMessageMetrics(): boolean {
  return typeof document.fonts === "undefined" || document.fonts.status === "loaded";
}

function getBrowserUserMessageProbe(): BrowserUserMessageProbe | null {
  if (browserUserMessageProbe?.host.isConnected) {
    return browserUserMessageProbe;
  }
  browserUserMessageProbe = createBrowserUserMessageProbe();
  return browserUserMessageProbe;
}

function getComputedStyleNumber(style: CSSStyleDeclaration, property: string): number | null {
  const raw = style.getPropertyValue(property);
  if (raw.length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBrowserUserMessageMetrics(): BrowserUserMessageMetrics | null {
  if (cachedBrowserUserMessageMetrics) {
    return cachedBrowserUserMessageMetrics;
  }

  const probe = getBrowserUserMessageProbe();
  if (!probe) {
    return null;
  }

  probe.text.textContent = "x";
  const bubbleStyle = window.getComputedStyle(probe.bubble);
  const textStyle = window.getComputedStyle(probe.text);
  const lineHeightPx = getComputedStyleNumber(textStyle, "line-height") ?? USER_LINE_HEIGHT_PX;
  const paddingLeftPx = getComputedStyleNumber(bubbleStyle, "padding-left") ?? 16;
  const paddingRightPx = getComputedStyleNumber(bubbleStyle, "padding-right") ?? 16;
  const borderLeftPx = getComputedStyleNumber(bubbleStyle, "border-left-width") ?? 1;
  const borderRightPx = getComputedStyleNumber(bubbleStyle, "border-right-width") ?? 1;
  const bubbleHorizontalChromePx = paddingLeftPx + paddingRightPx + borderLeftPx + borderRightPx;
  const baseHeightPx = Math.max(0, probe.bubble.getBoundingClientRect().height - lineHeightPx);
  const avgCharWidthPx =
    probe.widthSample.getBoundingClientRect().width / USER_MESSAGE_CHAR_WIDTH_SAMPLE.length;

  if (!Number.isFinite(baseHeightPx) || !Number.isFinite(avgCharWidthPx) || avgCharWidthPx <= 0) {
    return null;
  }

  const metrics = {
    avgCharWidthPx,
    baseHeightPx,
    bubbleHorizontalChromePx,
    lineHeightPx,
  };

  if (shouldCacheBrowserUserMessageMetrics()) {
    cachedBrowserUserMessageMetrics = metrics;
  }

  return metrics;
}

function estimateWrappedLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) return 1;

  // Avoid allocating via split for long logs; iterate once and count wrapped lines.
  let lines = 0;
  let currentLineLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
      currentLineLength = 0;
      continue;
    }
    currentLineLength += 1;
  }

  lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
  return lines;
}

function isFinitePositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function estimateCharsPerLineForUser(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return USER_CHARS_PER_LINE_FALLBACK;
  const browserMetrics = getBrowserUserMessageMetrics();
  if (browserMetrics) {
    const bubbleWidthPx = timelineWidthPx * USER_BUBBLE_WIDTH_RATIO;
    const textWidthPx = Math.max(bubbleWidthPx - browserMetrics.bubbleHorizontalChromePx, 0);
    return Math.max(
      MIN_USER_CHARS_PER_LINE,
      Math.floor(textWidthPx / browserMetrics.avgCharWidthPx),
    );
  }
  const bubbleWidthPx = timelineWidthPx * USER_BUBBLE_WIDTH_RATIO;
  const textWidthPx = Math.max(bubbleWidthPx - USER_BUBBLE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(MIN_USER_CHARS_PER_LINE, Math.floor(textWidthPx / USER_MONO_AVG_CHAR_WIDTH_PX));
}

function estimateCharsPerLineForAssistant(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return ASSISTANT_CHARS_PER_LINE_FALLBACK;
  const textWidthPx = Math.max(timelineWidthPx - ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(
    MIN_ASSISTANT_CHARS_PER_LINE,
    Math.floor(textWidthPx / ASSISTANT_AVG_CHAR_WIDTH_PX),
  );
}

function expandAssistantInlineCodeForEstimate(text: string) {
  return text.replace(INLINE_CODE_SPAN_REGEX, (_match, code: string) =>
    "x".repeat(
      Math.max(
        code.length + 2,
        Math.ceil(
          code.length * ASSISTANT_INLINE_CODE_WIDTH_MULTIPLIER +
            ASSISTANT_INLINE_CODE_WRAP_OVERHEAD_CHARS,
        ),
      ),
    ),
  );
}

export function estimateTimelineMessageHeight(
  message: TimelineMessageHeightInput,
  layout: TimelineHeightEstimateLayout = { timelineWidthPx: null },
): number {
  if (message.role === "assistant") {
    const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
    const estimatedLines = estimateWrappedLineCount(
      expandAssistantInlineCodeForEstimate(message.text),
      charsPerLine,
    );
    return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * ASSISTANT_LINE_HEIGHT_PX;
  }

  if (message.role === "user") {
    const charsPerLine = estimateCharsPerLineForUser(layout.timelineWidthPx);
    const browserMetrics = getBrowserUserMessageMetrics();
    const displayedUserMessage = deriveDisplayedUserMessageState(message.text);
    const renderedText =
      displayedUserMessage.contexts.length > 0
        ? [
            buildInlineTerminalContextText(displayedUserMessage.contexts),
            displayedUserMessage.visibleText,
          ]
            .filter((part) => part.length > 0)
            .join(" ")
        : displayedUserMessage.visibleText;
    const estimatedLines = estimateWrappedLineCount(renderedText, charsPerLine);
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentRows = Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW);
    const attachmentHeight = attachmentRows * USER_ATTACHMENT_ROW_HEIGHT_PX;
    return (
      (browserMetrics?.baseHeightPx ?? USER_BASE_HEIGHT_PX) +
      estimatedLines * (browserMetrics?.lineHeightPx ?? USER_LINE_HEIGHT_PX) +
      attachmentHeight
    );
  }

  // `system` messages are not rendered in the chat timeline, but keep a stable
  // explicit branch in case they are present in timeline data.
  const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
  const estimatedLines = estimateWrappedLineCount(
    expandAssistantInlineCodeForEstimate(message.text),
    charsPerLine,
  );
  return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * ASSISTANT_LINE_HEIGHT_PX;
}
