import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  isSameContextWindowSnapshot,
} from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 0,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("prefers total processed tokens for thread totals, falling back to context usage", () => {
    const withTotals = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
      }),
    ]);
    expect(withTotals?.threadTotalTokens).toBe(748_126);

    const withoutTotals = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 27_000,
      }),
    ]);
    expect(withoutTotals?.threadTotalTokens).toBe(27_000);
  });

  it("keeps the thread total when a later snapshot omits totalProcessedTokens", () => {
    // Claude only attaches totals at turn end; mid-turn snapshots carry bare
    // context sizes and must not regress the thread total.
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
      }),
      makeActivity("activity-2", "context-window.updated", {
        usedTokens: 82_000,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(82_000);
    expect(snapshot?.threadTotalTokens).toBe(748_126);
  });

  it("sums totals across provider accumulator resets", () => {
    // A restarted CLI session restarts its cumulative counter; earlier totals
    // are still spent tokens and must stay counted.
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 400_000,
        totalProcessedTokens: 1_789_632,
      }),
      makeActivity("activity-2", "context-window.updated", {
        usedTokens: 300_000,
        totalProcessedTokens: 1_461_021,
      }),
    ]);

    expect(snapshot?.threadTotalTokens).toBe(1_789_632 + 1_461_021);
  });

  it("uses peak context usage as the total when totals are never reported", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", { usedTokens: 900_000 }),
      makeActivity("activity-2", "context-window.updated", { usedTokens: 94_000 }),
    ]);

    expect(snapshot?.usedTokens).toBe(94_000);
    expect(snapshot?.threadTotalTokens).toBe(900_000);
  });

  it("treats snapshots as identical only for the same activity and total", () => {
    const base = [
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 10_000,
        totalProcessedTokens: 50_000,
      }),
    ];
    const a = deriveLatestContextWindowSnapshot(base);
    const b = deriveLatestContextWindowSnapshot([...base]);
    const c = deriveLatestContextWindowSnapshot([
      ...base,
      makeActivity("activity-2", "context-window.updated", {
        usedTokens: 11_000,
        totalProcessedTokens: 60_000,
      }),
    ]);

    expect(a && b && isSameContextWindowSnapshot(a, b)).toBe(true);
    expect(a && c && isSameContextWindowSnapshot(a, c)).toBe(false);
  });
});
