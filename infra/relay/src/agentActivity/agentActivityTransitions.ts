import type {
  RelayAgentActivityAggregateState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";
import { RelayAgentActivityAggregateState as RelayAgentActivityAggregateStateSchema } from "@t3tools/contracts/relay";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { alertAllowedForPhase } from "./agentAwarenessPreferences.ts";

// Transition logic shared by the APNs (iOS) and Expo push (Android) delivery
// paths. Alerts must ring on state *transitions* against the per-device
// last-delivered aggregate, never on republishes of an unchanged state, so
// both platforms compute "what changed" the same way.

export type AgentActivityAggregateRow = RelayAgentActivityAggregateState["activities"][number];

// Completions replayed long after the fact (server restarts republish every
// recently-finished thread) must not ring the device again.
export const TERMINAL_NOTIFICATION_FRESHNESS_MS = 2 * 60 * 1_000;

export const MIN_LIVE_ACTIVITY_UPDATE_INTERVAL_MS = 15_000;

const decodeRelayAgentActivityAggregateStateJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(RelayAgentActivityAggregateStateSchema),
);

export function parseAggregate(value: string | null): RelayAgentActivityAggregateState | null {
  if (!value) {
    return null;
  }
  return Option.getOrNull(decodeRelayAgentActivityAggregateStateJson(value));
}

export function isAttentionPhase(phase: string): boolean {
  return phase === "waiting_for_approval" || phase === "waiting_for_input";
}

export function aggregateNeedsAttention(aggregate: RelayAgentActivityAggregateState): boolean {
  return aggregate.activities.some((row) => isAttentionPhase(row.phase));
}

// Rows that entered an attention phase since the previously delivered
// aggregate. A null previous aggregate means there is no known baseline (fresh
// registration, replay after data loss) — alerting there would buzz on
// reconnect, not on a transition.
export function newlyAttentionRows(input: {
  readonly previousAggregate: RelayAgentActivityAggregateState | null;
  readonly nextAggregate: RelayAgentActivityAggregateState;
  readonly preferences: RelayAgentAwarenessPreferences | null;
}): ReadonlyArray<AgentActivityAggregateRow> {
  if (input.previousAggregate === null) {
    return [];
  }
  const previouslyAttention = new Set(
    input.previousAggregate.activities
      .filter((row) => isAttentionPhase(row.phase))
      .map((row) => row.threadId),
  );
  return input.nextAggregate.activities.filter(
    (row) =>
      isAttentionPhase(row.phase) &&
      !previouslyAttention.has(row.threadId) &&
      alertAllowedForPhase(input.preferences, row.phase),
  );
}

// Rows that finished (Done/Failed) since the previously delivered aggregate —
// the mid-flight completion buzz while other agents keep the activity alive.
// Requires the thread to have been present and non-terminal before, so a
// baseline-less replay or a row that merely fell off the display cap never
// rings.
export function newlyTerminalRows(
  previousAggregate: RelayAgentActivityAggregateState | null,
  nextAggregate: RelayAgentActivityAggregateState,
): ReadonlyArray<AgentActivityAggregateRow> {
  if (previousAggregate === null) {
    return [];
  }
  const previousPhases = new Map(
    previousAggregate.activities.map((row) => [row.threadId, row.phase]),
  );
  return nextAggregate.activities.filter((row) => {
    if (row.phase !== "completed" && row.phase !== "failed") {
      return false;
    }
    const previousPhase = previousPhases.get(row.threadId);
    return (
      previousPhase !== undefined && previousPhase !== "completed" && previousPhase !== "failed"
    );
  });
}

export function isFreshTerminalRow(row: AgentActivityAggregateRow, nowMs: number): boolean {
  const updatedAtMs = Option.match(DateTime.make(row.updatedAt), {
    onNone: () => null,
    onSome: (dt) => dt.epochMilliseconds,
  });
  return updatedAtMs !== null && nowMs - updatedAtMs <= TERMINAL_NOTIFICATION_FRESHNESS_MS;
}

export function freshNewlyTerminalRows(input: {
  readonly previousAggregate: RelayAgentActivityAggregateState | null;
  readonly nextAggregate: RelayAgentActivityAggregateState;
  readonly preferences: RelayAgentAwarenessPreferences | null;
  readonly nowMs: number;
}): ReadonlyArray<AgentActivityAggregateRow> {
  return newlyTerminalRows(input.previousAggregate, input.nextAggregate).filter(
    (row) =>
      alertAllowedForPhase(input.preferences, row.phase) &&
      // Replays of old aggregates (server restarts, redeliveries) repaint
      // state without ringing; only fresh completions buzz.
      isFreshTerminalRow(row, input.nowMs),
  );
}

export function shouldUpdateLiveActivity(input: {
  readonly previousAggregate: RelayAgentActivityAggregateState | null;
  readonly nextAggregate: RelayAgentActivityAggregateState;
  readonly lastDeliveryAt: string | null;
  readonly nowMs: number;
}): boolean {
  if (!input.previousAggregate) {
    return true;
  }
  if (JSON.stringify(input.previousAggregate) === JSON.stringify(input.nextAggregate)) {
    return false;
  }
  if (input.previousAggregate.activeCount !== input.nextAggregate.activeCount) {
    return true;
  }
  if (aggregateNeedsAttention(input.nextAggregate)) {
    return true;
  }
  // A thread finishing must never be throttled away: when a completion and a
  // new start land in the same window, activeCount is unchanged and the Done
  // transition (and its alert) would otherwise be suppressed.
  if (newlyTerminalRows(input.previousAggregate, input.nextAggregate).length > 0) {
    return true;
  }
  const lastDeliveryAtMs =
    input.lastDeliveryAt === null
      ? null
      : Option.match(DateTime.make(input.lastDeliveryAt), {
          onNone: () => Number.NaN,
          onSome: (dt) => dt.epochMilliseconds,
        });
  return (
    lastDeliveryAtMs === null ||
    Number.isNaN(lastDeliveryAtMs) ||
    input.nowMs - lastDeliveryAtMs >= MIN_LIVE_ACTIVITY_UPDATE_INTERVAL_MS
  );
}
