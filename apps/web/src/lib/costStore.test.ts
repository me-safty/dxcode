import { beforeEach, describe, expect, it } from "vitest";

import {
  COST_STORE_STORAGE_KEY,
  localMonthKey,
  reduceRecordTurnCost,
  reduceResetSession,
  sanitizePersistedCostState,
  selectCostSummary,
  useCostStore,
  type PersistedCostState,
} from "./costStore";

function freshState(): PersistedCostState {
  return { version: 1, sessions: {}, months: {} };
}

const cost = (total: number) => ({
  inputUsd: 0,
  cachedUsd: 0,
  outputUsd: 0,
  reasoningUsd: 0,
  totalUsd: total,
});

const deltas = (
  d: Partial<{
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  }> = {},
) => ({
  inputTokens: d.inputTokens ?? 0,
  cachedInputTokens: d.cachedInputTokens ?? 0,
  outputTokens: d.outputTokens ?? 0,
  reasoningOutputTokens: d.reasoningOutputTokens ?? 0,
});

describe("localMonthKey", () => {
  it("formats YYYY-MM in local tz", () => {
    const date = new Date(2026, 3, 7, 12, 0, 0); // April 7 2026 local
    expect(localMonthKey(date)).toBe("2026-04");
  });

  it("pads single-digit months", () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(localMonthKey(date)).toBe("2026-01");
  });
});

describe("reduceRecordTurnCost", () => {
  const at = new Date(2026, 3, 21, 10, 0, 0); // April 21 2026

  it("accumulates into session + month bucket", () => {
    let state = freshState();
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ inputTokens: 1_000, outputTokens: 500 }),
      breakdown: cost(0.01),
      at,
    });
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ inputTokens: 500, outputTokens: 200 }),
      breakdown: cost(0.005),
      at,
    });

    const session = state.sessions["t1"]!;
    expect(session.totalUsd).toBeCloseTo(0.015, 6);
    expect(session.turnCount).toBe(2);
    expect(session.byModel["claude-sonnet-4-6"]!.inputTokens).toBe(1_500);
    expect(session.byModel["claude-sonnet-4-6"]!.outputTokens).toBe(700);
    expect(session.byModel["claude-sonnet-4-6"]!.turnCount).toBe(2);

    const month = state.months["2026-04"]!;
    expect(month.totalUsd).toBeCloseTo(0.015, 6);
    expect(month.turnCount).toBe(2);
  });

  it("keeps per-model tallies separate", () => {
    let state = freshState();
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.01),
      at,
    });
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "gpt-5.4",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.02),
      at,
    });
    const session = state.sessions["t1"]!;
    expect(Object.keys(session.byModel).sort()).toEqual(["claude-sonnet-4-6", "gpt-5.4"]);
    expect(session.totalUsd).toBeCloseTo(0.03, 6);
  });

  it("isolates sessions by threadId", () => {
    let state = freshState();
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.01),
      at,
    });
    state = reduceRecordTurnCost(state, {
      threadId: "t2",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.02),
      at,
    });
    expect(state.sessions["t1"]!.totalUsd).toBeCloseTo(0.01, 6);
    expect(state.sessions["t2"]!.totalUsd).toBeCloseTo(0.02, 6);
    // Month aggregates both sessions.
    expect(state.months["2026-04"]!.totalUsd).toBeCloseTo(0.03, 6);
  });

  it("buckets by local month", () => {
    let state = freshState();
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.01),
      at: new Date(2026, 2, 31, 10, 0, 0), // March
    });
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.02),
      at: new Date(2026, 3, 1, 10, 0, 0), // April
    });
    expect(Object.keys(state.months).sort()).toEqual(["2026-03", "2026-04"]);
    expect(state.months["2026-03"]!.totalUsd).toBeCloseTo(0.01, 6);
    expect(state.months["2026-04"]!.totalUsd).toBeCloseTo(0.02, 6);
    // Session spans both months.
    expect(state.sessions["t1"]!.totalUsd).toBeCloseTo(0.03, 6);
  });

  it("ignores zero-token zero-cost turns", () => {
    const before = freshState();
    const after = reduceRecordTurnCost(before, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas(),
      breakdown: cost(0),
      at,
    });
    expect(after).toBe(before);
  });

  it("ignores blank threadId / model", () => {
    const before = freshState();
    const a = reduceRecordTurnCost(before, {
      threadId: "",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 10 }),
      breakdown: cost(0.01),
      at,
    });
    const b = reduceRecordTurnCost(before, {
      threadId: "t1",
      model: "",
      deltas: deltas({ outputTokens: 10 }),
      breakdown: cost(0.01),
      at,
    });
    expect(a).toBe(before);
    expect(b).toBe(before);
  });
});

describe("reduceResetSession", () => {
  it("removes the session but keeps month", () => {
    let state = freshState();
    state = reduceRecordTurnCost(state, {
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.01),
      at: new Date(2026, 3, 21, 10, 0, 0),
    });
    const next = reduceResetSession(state, "t1");
    expect(next.sessions["t1"]).toBeUndefined();
    expect(next.months["2026-04"]!.totalUsd).toBeCloseTo(0.01, 6);
  });

  it("no-op for unknown threadId", () => {
    const state = freshState();
    expect(reduceResetSession(state, "nope")).toBe(state);
  });
});

describe("sanitizePersistedCostState", () => {
  it("returns initial for garbage", () => {
    expect(sanitizePersistedCostState(null).sessions).toEqual({});
    expect(sanitizePersistedCostState("bad").months).toEqual({});
    expect(sanitizePersistedCostState({ version: 99 }).months).toEqual({});
  });

  it("drops invalid month keys", () => {
    const cleaned = sanitizePersistedCostState({
      version: 1,
      sessions: {},
      months: {
        "2026-04": { totalUsd: 1, turnCount: 1, byModel: {} },
        "bogus": { totalUsd: 99, turnCount: 1, byModel: {} },
      },
    });
    expect(Object.keys(cleaned.months)).toEqual(["2026-04"]);
  });

  it("coerces non-finite numbers to zero", () => {
    const cleaned = sanitizePersistedCostState({
      version: 1,
      sessions: {
        t1: {
          totalUsd: Number.NaN,
          turnCount: -5,
          byModel: {
            "claude-sonnet-4-6": {
              inputTokens: "abc",
              outputTokens: 10,
              totalUsd: 5,
              turnCount: 1,
            },
          },
        },
      },
      months: {},
    });
    const s = cleaned.sessions["t1"]!;
    expect(s.totalUsd).toBe(0);
    expect(s.turnCount).toBe(0);
    expect(s.byModel["claude-sonnet-4-6"]!.inputTokens).toBe(0);
    expect(s.byModel["claude-sonnet-4-6"]!.outputTokens).toBe(10);
    expect(s.byModel["claude-sonnet-4-6"]!.totalUsd).toBe(5);
  });
});

describe("selectCostSummary", () => {
  it("returns zero summary for empty state", () => {
    const summary = selectCostSummary(freshState(), "t1", new Date(2026, 3, 21));
    expect(summary.sessionUsd).toBe(0);
    expect(summary.monthUsd).toBe(0);
    expect(summary.averagePerTurnUsd).toBeNull();
    expect(summary.monthKey).toBe("2026-04");
  });

  it("computes average per turn", () => {
    let state = freshState();
    for (let i = 0; i < 4; i += 1) {
      state = reduceRecordTurnCost(state, {
        threadId: "t1",
        model: "claude-sonnet-4-6",
        deltas: deltas({ outputTokens: 100 }),
        breakdown: cost(0.01),
        at: new Date(2026, 3, 21),
      });
    }
    const summary = selectCostSummary(state, "t1", new Date(2026, 3, 21));
    expect(summary.sessionUsd).toBeCloseTo(0.04, 6);
    expect(summary.averagePerTurnUsd).toBeCloseTo(0.01, 6);
    expect(summary.sessionTurnCount).toBe(4);
  });
});

describe("useCostStore (zustand)", () => {
  beforeEach(() => {
    useCostStore.getState().resetAll();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(COST_STORE_STORAGE_KEY);
    }
  });

  it("records turn cost via action", () => {
    useCostStore.getState().recordTurnCost({
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ inputTokens: 1_000, outputTokens: 500 }),
      breakdown: cost(0.01),
      at: new Date(2026, 3, 21),
    });
    const state = useCostStore.getState();
    expect(state.sessions["t1"]!.totalUsd).toBeCloseTo(0.01, 6);
    expect(state.months["2026-04"]!.totalUsd).toBeCloseTo(0.01, 6);
  });

  it("resetSession clears one thread", () => {
    useCostStore.getState().recordTurnCost({
      threadId: "t1",
      model: "claude-sonnet-4-6",
      deltas: deltas({ outputTokens: 100 }),
      breakdown: cost(0.01),
      at: new Date(2026, 3, 21),
    });
    useCostStore.getState().resetSession("t1");
    expect(useCostStore.getState().sessions["t1"]).toBeUndefined();
  });
});
