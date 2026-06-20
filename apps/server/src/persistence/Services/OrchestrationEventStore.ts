import type * as OrchestrationEventStoreModule from "../OrchestrationEventStore.ts";

export { OrchestrationEventStore } from "../OrchestrationEventStore.ts";

/**
 * @deprecated Compatibility alias for the excluded orchestration tests only.
 * In-scope consumers must use `OrchestrationEventStore["Service"]`.
 */
export type OrchestrationEventStoreShape =
  OrchestrationEventStoreModule.OrchestrationEventStore["Service"];
