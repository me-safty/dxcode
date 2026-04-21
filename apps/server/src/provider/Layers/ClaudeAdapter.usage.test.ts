import { describe, expect, it } from "vitest";

import {
  buildClaudeTurnCompleteUsage,
  parseClaudeUsageBreakdown,
  type ClaudeTurnCompleteUsageResult,
} from "./ClaudeAdapter.ts";

describe("parseClaudeUsageBreakdown", () => {
  it("splits Anthropic fields into four token tiers", () => {
    const b = parseClaudeUsageBreakdown({
      input_tokens: 4,
      cache_creation_input_tokens: 2715,
      cache_read_input_tokens: 21144,
      output_tokens: 679,
    });
    expect(b).toEqual({
      inputTokens: 4,
      cachedInputTokens: 21144,
      cacheCreationInputTokens: 2715,
      outputTokens: 679,
      totalTokens: 4 + 2715 + 21144 + 679,
    });
  });

  it("prefers explicit total_tokens over the derived sum", () => {
    const b = parseClaudeUsageBreakdown({
      total_tokens: 999,
      input_tokens: 1,
      output_tokens: 2,
    });
    expect(b?.totalTokens).toBe(999);
  });

  it("derives total when only total_tokens reported", () => {
    const b = parseClaudeUsageBreakdown({ total_tokens: 42 });
    expect(b?.totalTokens).toBe(42);
    expect(b?.inputTokens).toBe(0);
  });

  it("returns undefined for empty / malformed input", () => {
    expect(parseClaudeUsageBreakdown(null)).toBeUndefined();
    expect(parseClaudeUsageBreakdown({})).toBeUndefined();
    expect(parseClaudeUsageBreakdown({ total_tokens: 0 })).toBeUndefined();
  });
});

describe("buildClaudeTurnCompleteUsage", () => {
  it("builds first-turn deltas equal to cumulative totals", () => {
    const res = buildClaudeTurnCompleteUsage({
      resultUsage: {
        input_tokens: 1_000,
        cache_read_input_tokens: 5_000,
        cache_creation_input_tokens: 2_000,
        output_tokens: 500,
      },
      taskSnapshot: undefined,
      contextWindow: 200_000,
      priorCumulative: undefined,
    });
    const snap = res.snapshot!;
    expect(snap.inputTokens).toBe(1_000);
    expect(snap.cachedInputTokens).toBe(5_000);
    expect(snap.cacheCreationInputTokens).toBe(2_000);
    expect(snap.outputTokens).toBe(500);
    expect(snap.lastInputTokens).toBe(1_000);
    expect(snap.lastCachedInputTokens).toBe(5_000);
    expect(snap.lastCacheCreationInputTokens).toBe(2_000);
    expect(snap.lastOutputTokens).toBe(500);
    expect(snap.lastUsedTokens).toBe(8_500);
    expect(snap.usedTokens).toBe(8_500);
    expect(snap.totalProcessedTokens).toBe(8_500);
    expect(snap.maxTokens).toBe(200_000);
    expect(res.nextCumulative).toBeDefined();
  });

  it("computes second-turn deltas against the prior cumulative", () => {
    const turn1 = buildClaudeTurnCompleteUsage({
      resultUsage: {
        input_tokens: 1_000,
        cache_read_input_tokens: 5_000,
        output_tokens: 500,
      },
      taskSnapshot: undefined,
      contextWindow: 200_000,
      priorCumulative: undefined,
    });
    const turn2 = buildClaudeTurnCompleteUsage({
      resultUsage: {
        // Cumulative totals have grown — turn 2 added 500 input, 1k cached,
        // 300 cache-creation, 200 output.
        input_tokens: 1_500,
        cache_read_input_tokens: 6_000,
        cache_creation_input_tokens: 300,
        output_tokens: 700,
      },
      taskSnapshot: undefined,
      contextWindow: 200_000,
      priorCumulative: turn1.nextCumulative,
    });
    const s = turn2.snapshot!;
    expect(s.inputTokens).toBe(1_500);
    expect(s.cachedInputTokens).toBe(6_000);
    expect(s.cacheCreationInputTokens).toBe(300);
    expect(s.outputTokens).toBe(700);
    expect(s.lastInputTokens).toBe(500);
    expect(s.lastCachedInputTokens).toBe(1_000);
    expect(s.lastCacheCreationInputTokens).toBe(300);
    expect(s.lastOutputTokens).toBe(200);
    expect(s.lastUsedTokens).toBe(500 + 1_000 + 300 + 200);
  });

  it("does not cap usedTokens to maxTokens", () => {
    const res = buildClaudeTurnCompleteUsage({
      resultUsage: { total_tokens: 535_000 },
      taskSnapshot: undefined,
      contextWindow: 200_000,
      priorCumulative: undefined,
    });
    expect(res.snapshot!.usedTokens).toBe(535_000);
    expect(res.snapshot!.maxTokens).toBe(200_000);
  });

  it("uses task snapshot usedTokens when available (current context)", () => {
    const res = buildClaudeTurnCompleteUsage({
      resultUsage: { total_tokens: 535_000 },
      taskSnapshot: {
        usedTokens: 190_000,
        lastUsedTokens: 190_000,
      },
      contextWindow: 200_000,
      priorCumulative: undefined,
    });
    expect(res.snapshot!.usedTokens).toBe(190_000);
    expect(res.snapshot!.totalProcessedTokens).toBe(535_000);
  });

  it("falls back to task snapshot when result.usage is absent", () => {
    const res: ClaudeTurnCompleteUsageResult = buildClaudeTurnCompleteUsage({
      resultUsage: undefined,
      taskSnapshot: { usedTokens: 500, lastUsedTokens: 500 },
      contextWindow: 100_000,
      priorCumulative: undefined,
    });
    expect(res.snapshot?.usedTokens).toBe(500);
    expect(res.nextCumulative).toBeUndefined();
  });

  it("clamps negative deltas to zero when cumulative goes backwards", () => {
    const prior = {
      inputTokens: 1_000,
      cachedInputTokens: 5_000,
      cacheCreationInputTokens: 0,
      outputTokens: 500,
      totalTokens: 6_500,
    };
    // Unexpected: SDK reports lower cumulative (shouldn't happen, but guard
    // against it so cost math never goes negative).
    const res = buildClaudeTurnCompleteUsage({
      resultUsage: {
        input_tokens: 900,
        cache_read_input_tokens: 4_000,
        output_tokens: 400,
      },
      taskSnapshot: undefined,
      priorCumulative: prior,
    });
    const s = res.snapshot!;
    expect(s.lastInputTokens).toBeUndefined(); // delta was 0
    expect(s.lastCachedInputTokens).toBeUndefined();
    expect(s.lastOutputTokens).toBeUndefined();
  });
});
