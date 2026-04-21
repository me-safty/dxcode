import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";
import type { TurnCostBreakdown, TurnTokenDeltas } from "@t3tools/shared/pricing";
import { formatUsd } from "@t3tools/shared/pricing";

export const COST_STORE_STORAGE_KEY = "t3code:cost-store:v1";

/** Cumulative token counts + USD spend for one model within a bucket. */
export interface ModelCostEntry {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalUsd: number;
  turnCount: number;
}

export interface CostBucket {
  totalUsd: number;
  turnCount: number;
  byModel: Record<string, ModelCostEntry>;
}

export interface PersistedCostState {
  version: 1;
  sessions: Record<string, CostBucket>;
  months: Record<string, CostBucket>;
}

export interface CostStoreState extends PersistedCostState {
  recordTurnCost: (input: RecordTurnCostInput) => void;
  resetSession: (threadId: string) => void;
  resetAll: () => void;
  /** Test-only hook: replace state atomically. */
  __replaceState: (next: PersistedCostState) => void;
}

export interface RecordTurnCostInput {
  threadId: string;
  model: string;
  deltas: TurnTokenDeltas;
  breakdown: TurnCostBreakdown;
  /** Override "now" for deterministic tests. */
  at?: Date;
}

const emptyBucket: () => CostBucket = () => ({ totalUsd: 0, turnCount: 0, byModel: {} });
const emptyModelEntry: () => ModelCostEntry = () => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalUsd: 0,
  turnCount: 0,
});

const initialState: PersistedCostState = {
  version: 1,
  sessions: {},
  months: {},
};

/**
 * Compute `YYYY-MM` key for a Date in the **local** timezone.
 * Done via `getFullYear/getMonth` (not toISOString) so the month rolls over
 * on the user's clock, not UTC's.
 */
export function localMonthKey(date: Date = new Date()): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

function addTurnToEntry(
  entry: ModelCostEntry,
  deltas: TurnTokenDeltas,
  breakdown: TurnCostBreakdown,
): ModelCostEntry {
  return {
    inputTokens: entry.inputTokens + deltas.inputTokens,
    cachedInputTokens: entry.cachedInputTokens + deltas.cachedInputTokens,
    outputTokens: entry.outputTokens + deltas.outputTokens,
    reasoningOutputTokens: entry.reasoningOutputTokens + deltas.reasoningOutputTokens,
    totalUsd: entry.totalUsd + breakdown.totalUsd,
    turnCount: entry.turnCount + 1,
  };
}

function addTurnToBucket(
  bucket: CostBucket,
  model: string,
  deltas: TurnTokenDeltas,
  breakdown: TurnCostBreakdown,
): CostBucket {
  const existing = bucket.byModel[model] ?? emptyModelEntry();
  return {
    totalUsd: bucket.totalUsd + breakdown.totalUsd,
    turnCount: bucket.turnCount + 1,
    byModel: {
      ...bucket.byModel,
      [model]: addTurnToEntry(existing, deltas, breakdown),
    },
  };
}

/** Pure reducer: record one turn into the given state. */
export function reduceRecordTurnCost(
  state: PersistedCostState,
  input: RecordTurnCostInput,
): PersistedCostState {
  const { threadId, model, deltas, breakdown } = input;
  if (!threadId || !model) {
    return state;
  }
  // Skip no-op turns to keep storage tiny.
  const totalTokens =
    deltas.inputTokens +
    deltas.cachedInputTokens +
    deltas.outputTokens +
    deltas.reasoningOutputTokens;
  if (totalTokens <= 0 && breakdown.totalUsd <= 0) {
    return state;
  }
  const monthKey = localMonthKey(input.at ?? new Date());
  const session = state.sessions[threadId] ?? emptyBucket();
  const month = state.months[monthKey] ?? emptyBucket();
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [threadId]: addTurnToBucket(session, model, deltas, breakdown),
    },
    months: {
      ...state.months,
      [monthKey]: addTurnToBucket(month, model, deltas, breakdown),
    },
  };
}

export function reduceResetSession(
  state: PersistedCostState,
  threadId: string,
): PersistedCostState {
  if (!(threadId in state.sessions)) {
    return state;
  }
  const nextSessions = { ...state.sessions };
  delete nextSessions[threadId];
  return { ...state, sessions: nextSessions };
}

function sanitizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function sanitizeModelEntry(raw: unknown): ModelCostEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  return {
    inputTokens: sanitizeNumber(r.inputTokens),
    cachedInputTokens: sanitizeNumber(r.cachedInputTokens),
    outputTokens: sanitizeNumber(r.outputTokens),
    reasoningOutputTokens: sanitizeNumber(r.reasoningOutputTokens),
    totalUsd: sanitizeNumber(r.totalUsd),
    turnCount: sanitizeNumber(r.turnCount),
  };
}

function sanitizeBucket(raw: unknown): CostBucket | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const byModelRaw = (r.byModel ?? {}) as Record<string, unknown>;
  const byModel: Record<string, ModelCostEntry> = {};
  if (byModelRaw && typeof byModelRaw === "object") {
    for (const [model, entry] of Object.entries(byModelRaw)) {
      if (!model) continue;
      const cleaned = sanitizeModelEntry(entry);
      if (cleaned) byModel[model] = cleaned;
    }
  }
  return {
    totalUsd: sanitizeNumber(r.totalUsd),
    turnCount: sanitizeNumber(r.turnCount),
    byModel,
  };
}

export function sanitizePersistedCostState(raw: unknown): PersistedCostState {
  if (!raw || typeof raw !== "object") {
    return initialState;
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    return initialState;
  }
  const sessions: Record<string, CostBucket> = {};
  const months: Record<string, CostBucket> = {};
  const sessionsRaw = (r.sessions ?? {}) as Record<string, unknown>;
  const monthsRaw = (r.months ?? {}) as Record<string, unknown>;
  if (sessionsRaw && typeof sessionsRaw === "object") {
    for (const [threadId, bucket] of Object.entries(sessionsRaw)) {
      if (!threadId) continue;
      const cleaned = sanitizeBucket(bucket);
      if (cleaned) sessions[threadId] = cleaned;
    }
  }
  if (monthsRaw && typeof monthsRaw === "object") {
    for (const [monthKey, bucket] of Object.entries(monthsRaw)) {
      if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
      const cleaned = sanitizeBucket(bucket);
      if (cleaned) months[monthKey] = cleaned;
    }
  }
  return { version: 1, sessions, months };
}

function readPersistedState(): PersistedCostState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(COST_STORE_STORAGE_KEY);
    if (!raw) return initialState;
    return sanitizePersistedCostState(JSON.parse(raw));
  } catch {
    return initialState;
  }
}

function persistState(state: PersistedCostState): void {
  if (typeof window === "undefined") return;
  try {
    const { version, sessions, months } = state;
    window.localStorage.setItem(
      COST_STORE_STORAGE_KEY,
      JSON.stringify({ version, sessions, months } satisfies PersistedCostState),
    );
  } catch {
    // ignore quota / serialization errors
  }
}

const debouncedPersist = new Debouncer(persistState, { wait: 400 });

export const useCostStore = create<CostStoreState>((set) => ({
  ...readPersistedState(),
  recordTurnCost: (input) => set((state) => reduceRecordTurnCost(state, input)),
  resetSession: (threadId) => set((state) => reduceResetSession(state, threadId)),
  resetAll: () => set(() => ({ ...initialState })),
  __replaceState: (next) => set(() => ({ ...next })),
}));

useCostStore.subscribe((state) => {
  const { version, sessions, months } = state;
  debouncedPersist.maybeExecute({ version, sessions, months });
});

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersist.flush();
  });
}

// ── Selectors ────────────────────────────────────────────────────────────

export function selectSessionBucket(
  state: PersistedCostState,
  threadId: string | null | undefined,
): CostBucket {
  if (!threadId) return emptyBucket();
  return state.sessions[threadId] ?? emptyBucket();
}

export function selectMonthBucket(
  state: PersistedCostState,
  monthKey: string = localMonthKey(),
): CostBucket {
  return state.months[monthKey] ?? emptyBucket();
}

export interface CostSummary {
  readonly sessionUsd: number;
  readonly monthUsd: number;
  readonly sessionTurnCount: number;
  readonly monthTurnCount: number;
  readonly monthKey: string;
  readonly session: CostBucket;
  readonly month: CostBucket;
  readonly averagePerTurnUsd: number | null;
}

export function selectCostSummary(
  state: PersistedCostState,
  threadId: string | null | undefined,
  now: Date = new Date(),
): CostSummary {
  const monthKey = localMonthKey(now);
  const session = selectSessionBucket(state, threadId);
  const month = selectMonthBucket(state, monthKey);
  const averagePerTurnUsd =
    session.turnCount > 0 ? session.totalUsd / session.turnCount : null;
  return {
    sessionUsd: session.totalUsd,
    monthUsd: month.totalUsd,
    sessionTurnCount: session.turnCount,
    monthTurnCount: month.turnCount,
    monthKey,
    session,
    month,
    averagePerTurnUsd,
  };
}

export { formatUsd };
