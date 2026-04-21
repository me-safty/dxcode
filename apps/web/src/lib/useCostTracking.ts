import { useEffect, useRef } from "react";
import type { ModelSelection, OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  computeTurnCost,
  type TurnCostBreakdown,
  type TurnTokenDeltas,
} from "@t3tools/shared/pricing";

import { useCostStore, type RecordTurnCostInput } from "./costStore";

interface SeenRef {
  threadId: string | null | undefined;
  ids: Set<string>;
}

function toNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function extractDeltas(payload: unknown): TurnTokenDeltas | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const input = toNonNegative(p.lastInputTokens);
  const cached = toNonNegative(p.lastCachedInputTokens);
  const output = toNonNegative(p.lastOutputTokens);
  const reasoning = toNonNegative(p.lastReasoningOutputTokens);
  if (input + cached + output + reasoning <= 0) return null;
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
  };
}

export interface ProcessActivitiesResult {
  readonly records: ReadonlyArray<RecordTurnCostInput>;
  readonly nextSeen: Set<string>;
}

/**
 * Pure: find new `context-window.updated` events that carry per-turn
 * token deltas and translate them into cost-store inputs. Returns updated
 * "seen" set for caller to persist.
 *
 * Behaviour:
 *   - If `prevSeen` is `null`, treat all activities as "already seen" and
 *     emit no records — used for initial mount / thread switch.
 *   - Otherwise, only new activity IDs are considered.
 */
export function processActivitiesForCost(
  threadId: string | null | undefined,
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  modelSelection: ModelSelection | null | undefined,
  prevSeen: Set<string> | null,
): ProcessActivitiesResult {
  if (!threadId || !activities || activities.length === 0) {
    return { records: [], nextSeen: prevSeen ?? new Set() };
  }
  if (prevSeen === null) {
    // Initial mount / thread switch: seed seen set with current activity IDs.
    return {
      records: [],
      nextSeen: new Set(activities.map((a) => a.id as string)),
    };
  }
  const seen = new Set(prevSeen);
  const model = modelSelection?.model;
  const provider = modelSelection?.provider;
  const records: RecordTurnCostInput[] = [];
  for (const activity of activities) {
    const id = activity.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (activity.kind !== "context-window.updated") continue;
    const deltas = extractDeltas(activity.payload);
    if (!deltas) continue;
    if (!model) continue;
    const breakdown: TurnCostBreakdown = computeTurnCost(model, deltas, provider);
    if (breakdown.totalUsd <= 0) continue;
    records.push({
      threadId,
      model,
      deltas,
      breakdown,
      at: activity.createdAt ? new Date(activity.createdAt) : new Date(),
    });
  }
  return { records, nextSeen: seen };
}

/**
 * Observe thread activity stream and record cost for each new
 * `context-window.updated` event. Seeds on first mount so historical
 * activities aren't retroactively charged.
 */
export function useCostTracking(
  threadId: string | null | undefined,
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  modelSelection: ModelSelection | null | undefined,
): void {
  const recordTurnCost = useCostStore((state) => state.recordTurnCost);
  const seenRef = useRef<SeenRef>({ threadId: undefined, ids: new Set() });

  useEffect(() => {
    const prev = seenRef.current.threadId === threadId ? seenRef.current.ids : null;
    const { records, nextSeen } = processActivitiesForCost(
      threadId,
      activities,
      modelSelection,
      prev,
    );
    seenRef.current = { threadId, ids: nextSeen };
    for (const record of records) {
      recordTurnCost(record);
    }
  }, [threadId, activities, modelSelection, recordTurnCost]);
}
