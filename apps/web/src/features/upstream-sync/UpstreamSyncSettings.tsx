import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { UpstreamPolicy } from "@t3tools/contracts";
import { LoaderIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { APP_BASE_NAME } from "../../branding";
import { Button } from "../../components/ui/button";
import { Radio, RadioGroup } from "../../components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { upstreamSyncEnvironment } from "../../state/upstreamSync";
import { UpstreamUpdateDialog } from "./UpstreamUpdateDialog";

const POLICY_OPTIONS: ReadonlyArray<{
  readonly value: UpstreamPolicy;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "nightly-tags",
    label: "Nightly tags every 12 hours",
    description: "Grouped, reproducible upstream updates.",
  },
  {
    value: "stable-tags",
    label: "Stable releases",
    description: "Notify only for stable tags.",
  },
  {
    value: "manual",
    label: "Manual only",
    description: "Disable scheduled remote checks.",
  },
];

export function UpstreamSyncSettings() {
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const projects = useProjects();
  const settings = usePrimarySettings((value) => value.upstreamSync);
  const updateSettings = useUpdatePrimarySettings();
  const check = useAtomCommand(upstreamSyncEnvironment.check, { reportFailure: false });
  const stateQuery = useEnvironmentQuery(
    environmentId === null ? null : upstreamSyncEnvironment.state({ environmentId, input: {} }),
  );
  const [checking, setChecking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );

  if (APP_BASE_NAME !== "DX Code") return null;

  const handleCheck = async () => {
    if (environmentId === null) return;
    setChecking(true);
    setError(null);
    const result = await check({ environmentId, input: { reason: "manual" } });
    setChecking(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = result.cause.reasons.find((reason) => reason._tag === "Fail");
        setError(
          failure?.error instanceof Error ? failure.error.message : "Could not check upstream.",
        );
      }
      return;
    }
    if (result.value.status === "available" || result.value.status === "dismissed") {
      setDialogOpen(true);
    }
  };

  const state = stateQuery.data;
  const canReview =
    state?.status === "available" ||
    state?.status === "dismissed" ||
    state?.status === "session-active";

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="grid gap-2">
        <label className="text-xs font-medium text-foreground" htmlFor="upstream-source-project">
          DX source checkout
        </label>
        <Select
          value={settings.sourceProjectId ?? ""}
          onValueChange={(value) => {
            if (!value) return;
            const selected = sourceProjects.find((project) => project.id === value);
            if (!selected) return;
            if (
              !window.confirm(
                `Use ${selected.title} at ${selected.workspaceRoot} for T3 upstream synchronization?`,
              )
            ) {
              return;
            }
            updateSettings({
              upstreamSync: { ...settings, sourceProjectId: selected.id },
            });
          }}
        >
          <SelectTrigger id="upstream-source-project" size="sm">
            <SelectValue placeholder="Choose a source project" />
          </SelectTrigger>
          <SelectContent>
            {sourceProjects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                <span className="grid min-w-0">
                  <span className="truncate">{project.title}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {project.workspaceRoot}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The server validates <code>origin</code> and <code>upstream</code> before every sync.
        </p>
      </div>

      <RadioGroup
        value={settings.policy}
        onValueChange={(value) =>
          updateSettings({
            upstreamSync: { ...settings, policy: value as UpstreamPolicy },
          })
        }
      >
        {POLICY_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2.5 text-xs">
            <Radio value={option.value} />
            <span className="grid gap-0.5">
              <span className="font-medium text-foreground">{option.label}</span>
              <span className="text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>

      <label className="flex items-center justify-between gap-4 text-xs">
        <span className="grid gap-0.5">
          <span className="font-medium text-foreground">Pause update notifications</span>
          <span className="text-muted-foreground">
            Scheduled remote calls stop. Manual checks remain available.
          </span>
        </span>
        <Switch
          checked={settings.paused}
          onCheckedChange={(paused) => updateSettings({ upstreamSync: { ...settings, paused } })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={checking || settings.sourceProjectId === null}
          onClick={handleCheck}
        >
          {checking ? <LoaderIcon className="animate-spin" /> : <RefreshCwIcon />}
          Check for T3 updates
        </Button>
        {canReview ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            {state?.status === "dismissed"
              ? "Review anyway"
              : state?.status === "session-active"
                ? "Resume synchronization"
                : "Review update"}
          </Button>
        ) : null}
        {state?.status === "dismissed" ? (
          <span className="text-xs text-muted-foreground">Dismissed {state.target.tag}</span>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {environmentId && state && canReview ? (
        <UpstreamUpdateDialog
          open={dialogOpen}
          environmentId={environmentId}
          state={state}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </div>
  );
}
