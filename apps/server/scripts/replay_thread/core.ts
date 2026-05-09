import { createHash } from "node:crypto";

export interface TimingStats {
  readonly count: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export interface ReplayTimingSample {
  readonly fromEvent: number;
  readonly toEvent: number;
  readonly stats: TimingStats;
}

export function calculateTimingStats(values: ReadonlyArray<number>): TimingStats {
  if (values.length === 0) {
    return {
      count: 0,
      totalMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }

  const sorted = [...values].toSorted((left, right) => left - right);
  const totalMs = values.reduce((total, value) => total + value, 0);
  const percentile = (percent: number) => {
    const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
    return sorted[Math.max(0, index)] ?? 0;
  };

  return {
    count: values.length,
    totalMs,
    meanMs: totalMs / values.length,
    p50Ms: percentile(50),
    p90Ms: percentile(90),
    p99Ms: percentile(99),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

export function buildTimingSamples(
  timings: ReadonlyArray<number>,
  sampleEvery: number,
): ReadonlyArray<ReplayTimingSample> {
  const normalizedSampleEvery = Math.max(1, Math.floor(sampleEvery));
  const samples: Array<ReplayTimingSample> = [];
  for (let start = 0; start < timings.length; start += normalizedSampleEvery) {
    const end = Math.min(timings.length, start + normalizedSampleEvery);
    samples.push({
      fromEvent: start + 1,
      toEvent: end,
      stats: calculateTimingStats(timings.slice(start, end)),
    });
  }
  return samples;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function checksumRows(rows: ReadonlyArray<Record<string, unknown>>): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(stableJson(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function classifyReplayEvent(event: {
  readonly type: string;
  readonly payload: unknown;
}): "assistant-streaming-message" | "other" {
  if (event.type !== "thread.message-sent") {
    return "other";
  }
  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  return payload.role === "assistant" && payload.streaming === true
    ? "assistant-streaming-message"
    : "other";
}
