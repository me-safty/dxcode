import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { AutomationRule } from "../shared/schema.ts";

export const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export function automationThreadTitle(rule: AutomationRule, scheduledFor: string): string {
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: rule.timezone,
  }).format(DateTime.toDate(DateTime.makeUnsafe(scheduledFor)));
  return `${rule.name} - ${formatted}`;
}
