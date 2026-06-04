import type { PluginUiContext } from "@t3tools/plugin-api/ui";

import type { AutomationRule, AutomationRuleId, AutomationRun } from "../../shared/schema.ts";
import { formatDateTime, runStatusTone } from "../domain.ts";
import type { PluginProject, RuleActions } from "../types.ts";

export function RulesSection({
  ctx,
  rules,
  runs,
  loading,
  pendingAction,
  projectById,
  onRunNow,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  readonly ctx: PluginUiContext;
  readonly rules: ReadonlyArray<AutomationRule>;
  readonly runs: ReadonlyArray<AutomationRun>;
  readonly loading: boolean;
  readonly pendingAction: string | null;
  readonly projectById: ReadonlyMap<string, PluginProject>;
} & RuleActions) {
  const React = ctx.react;
  const C = ctx.components;
  const latestRunByRuleId = React.useMemo(() => {
    const latest = new Map<AutomationRuleId, AutomationRun>();
    for (const run of runs) {
      if (!latest.has(run.ruleId)) {
        latest.set(run.ruleId, run);
      }
    }
    return latest;
  }, [runs]);

  return (
    <C.Section title="Rules">
      {rules.length === 0 ? (
        <C.List>
          <C.EmptyState
            title={loading ? "Loading automations" : "No matching automations"}
            description={
              loading
                ? "Rule data is being refreshed."
                : "Create an automation or adjust the active filters."
            }
          />
        </C.List>
      ) : (
        <C.List>
          {rules.map((rule) => {
            const project = projectById.get(rule.projectId);
            const latestRun = latestRunByRuleId.get(rule.id);

            return (
              <C.ListRow
                key={rule.id}
                actions={
                  <>
                    <C.Switch
                      checked={rule.enabled}
                      disabled={pendingAction === `toggle:${rule.id}`}
                      onCheckedChange={(enabled) => onToggleEnabled(rule, enabled)}
                    />
                    <C.Button
                      disabled={pendingAction === `run:${rule.id}`}
                      onClick={() => onRunNow(rule)}
                      size="xs"
                    >
                      Run
                    </C.Button>
                    <C.Button onClick={() => onEdit(rule)} size="xs">
                      Edit
                    </C.Button>
                    <C.Button
                      disabled={pendingAction === `delete:${rule.id}`}
                      onClick={() => onDelete(rule)}
                      size="xs"
                      variant="danger"
                    >
                      Delete
                    </C.Button>
                  </>
                }
              >
                <C.Stack gap="xs">
                  <C.Inline gap="sm">
                    <C.Text title={rule.name} truncate variant="heading">
                      {rule.name}
                    </C.Text>
                    <C.Badge tone={rule.enabled ? "success" : "muted"}>
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </C.Badge>
                    {latestRun ? (
                      <C.Badge tone={runStatusTone(latestRun.status)}>{latestRun.status}</C.Badge>
                    ) : null}
                  </C.Inline>
                  <C.Inline gap="md">
                    <C.Text tone="muted" variant="caption">
                      {project?.name ?? rule.projectId}
                    </C.Text>
                    <C.Text tone="muted" variant="caption">
                      {rule.cron}
                    </C.Text>
                    <C.Text tone="muted" variant="caption">
                      {rule.timezone}
                    </C.Text>
                  </C.Inline>
                  {latestRun ? (
                    <C.Text tone="muted" variant="caption">
                      Last run {formatDateTime(latestRun.scheduledFor, rule.timezone)}
                    </C.Text>
                  ) : null}
                </C.Stack>
              </C.ListRow>
            );
          })}
        </C.List>
      )}
    </C.Section>
  );
}
