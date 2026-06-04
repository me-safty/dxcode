import type { PluginUiContext } from "@t3tools/plugin-api/ui";
import type * as ReactTypes from "react";

import type { AutomationRule } from "../shared/schema.ts";

export type Css = ReactTypes.CSSProperties;
export type RuleStatusFilter = "all" | "enabled" | "disabled";
export type PluginProject = ReturnType<PluginUiContext["host"]["useProjects"]>[number];

export interface RuleFormState {
  readonly name: string;
  readonly enabled: boolean;
  readonly projectId: string;
  readonly cron: string;
  readonly timezone: string;
  readonly prompt: string;
}

export interface RuleActions {
  readonly onRunNow: (rule: AutomationRule) => void;
  readonly onEdit: (rule: AutomationRule) => void;
  readonly onDelete: (rule: AutomationRule) => void;
  readonly onToggleEnabled: (rule: AutomationRule, enabled: boolean) => void;
}
