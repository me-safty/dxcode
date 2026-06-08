import type { OrchestrationEvent } from "@t3tools/contracts";

export const THREAD_DETAIL_ORCHESTRATION_EVENT_TYPES = [
  "thread.message-sent",
  "thread.turn-queued",
  "thread.queued-turn-cancelled",
  "thread.queued-turn-dispatched",
  "thread.proposed-plan-upserted",
  "thread.activity-appended",
  "thread.turn-diff-completed",
  "thread.reverted",
  "thread.session-set",
] as const;

export type ThreadDetailOrchestrationEvent = Extract<
  OrchestrationEvent,
  {
    type: (typeof THREAD_DETAIL_ORCHESTRATION_EVENT_TYPES)[number];
  }
>;

const THREAD_DETAIL_ORCHESTRATION_EVENT_TYPE_SET = new Set<string>(
  THREAD_DETAIL_ORCHESTRATION_EVENT_TYPES,
);

export function isThreadDetailOrchestrationEvent(
  event: OrchestrationEvent,
): event is ThreadDetailOrchestrationEvent {
  return THREAD_DETAIL_ORCHESTRATION_EVENT_TYPE_SET.has(event.type);
}
