import type { PluginUiBadgeTone } from "@t3tools/plugin-api/ui";

import { DEFAULT_CRON } from "../shared/constants.ts";
import type { AutomationRule, AutomationRun } from "../shared/schema.ts";
import type { RuleFormState, RuleStatusFilter } from "./types.ts";

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function emptyForm(projectId: string): RuleFormState {
  return {
    name: "",
    enabled: true,
    projectId,
    cron: DEFAULT_CRON,
    timezone: browserTimezone(),
    prompt: "",
  };
}

export function formFromRule(rule: AutomationRule): RuleFormState {
  return {
    name: rule.name,
    enabled: rule.enabled,
    projectId: rule.projectId,
    cron: rule.cron,
    timezone: rule.timezone,
    prompt: rule.prompt,
  };
}

export function filterRules(input: {
  readonly rules: ReadonlyArray<AutomationRule>;
  readonly projectFilter: string;
  readonly statusFilter: RuleStatusFilter;
}): ReadonlyArray<AutomationRule> {
  return input.rules
    .filter((rule) => input.projectFilter === "all" || rule.projectId === input.projectFilter)
    .filter((rule) => {
      if (input.statusFilter === "enabled") return rule.enabled;
      if (input.statusFilter === "disabled") return !rule.enabled;
      return true;
    });
}

export function formatDateTime(value: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(Date.parse(value));
  } catch {
    return value;
  }
}

export function commandErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Automation command failed.";
}

export function runStatusTone(status: AutomationRun["status"]): PluginUiBadgeTone {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "skipped":
      return "warning";
    case "running":
    case "queued":
      return "info";
  }
}
