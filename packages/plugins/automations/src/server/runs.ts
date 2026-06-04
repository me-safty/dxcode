import type { AutomationRun } from "../shared/schema.ts";

export function compareNewestRuns(first: AutomationRun, second: AutomationRun): number {
  const scheduled = second.scheduledFor.localeCompare(first.scheduledFor);
  if (scheduled !== 0) {
    return scheduled;
  }
  return second.id.localeCompare(first.id);
}
