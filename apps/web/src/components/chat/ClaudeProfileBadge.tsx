import { CheckIcon, UserIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnvironmentId, ProjectProviderOverride } from "@t3tools/contracts";
import { ensureEnvironmentApi } from "~/environmentApi";
import { useSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

interface ClaudeProfileBadgeProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly compact?: boolean;
}

function projectOverrideQueryKey(environmentId: EnvironmentId, cwd: string) {
  return ["project", "providerOverride", environmentId, cwd] as const;
}

export function ClaudeProfileBadge({ environmentId, cwd, compact }: ClaudeProfileBadgeProps) {
  const settings = useSettings();
  const claude = settings.providers.claudeAgent;
  const profiles = claude.profiles;
  const queryClient = useQueryClient();

  const overrideQuery = useQuery({
    queryKey: cwd
      ? projectOverrideQueryKey(environmentId, cwd)
      : ["project", "providerOverride", "noop"],
    enabled: Boolean(cwd),
    queryFn: async () => {
      if (!cwd) return { override: undefined };
      const api = ensureEnvironmentApi(environmentId);
      return api.projects.getProviderOverride({ cwd });
    },
  });

  const override = overrideQuery.data?.override;
  const activeProfileId = override?.claudeProfileId ?? claude.defaultProfileId;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];

  const setOverrideMutation = useMutation({
    mutationFn: async (nextOverride: ProjectProviderOverride) => {
      if (!cwd) return;
      const api = ensureEnvironmentApi(environmentId);
      await api.projects.setProviderOverride({ cwd, override: nextOverride });
    },
    onSuccess: () => {
      if (!cwd) return;
      queryClient.invalidateQueries({ queryKey: projectOverrideQueryKey(environmentId, cwd) });
    },
  });

  const handleSelect = useCallback(
    (profileId: string) => {
      if (!cwd) return;
      setOverrideMutation.mutate({
        provider: "claudeAgent",
        claudeProfileId: profileId,
      });
    },
    [cwd, setOverrideMutation],
  );

  const handleClearOverride = useCallback(() => {
    if (!cwd) return;
    setOverrideMutation.mutate({});
  }, [cwd, setOverrideMutation]);

  const label = useMemo(() => activeProfile?.label ?? "Claude", [activeProfile]);

  if (!activeProfile) return null;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground",
          compact ? "h-6" : "h-7",
        )}
        aria-label={`Claude profile: ${label}`}
      >
        <UserIcon className="size-3" aria-hidden />
        <span className="max-w-24 truncate font-medium">{label}</span>
      </PopoverTrigger>
      <PopoverPopup className="w-64 p-2" align="start" side="top">
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Claude profile
        </div>
        <div className="flex flex-col">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => handleSelect(profile.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40",
                  isActive && "text-foreground",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{profile.label}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {profile.homePath || "default (~/.claude)"}
                  </div>
                </div>
                {isActive ? (
                  <CheckIcon className="size-3 shrink-0 text-foreground" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
        {override?.claudeProfileId ? (
          <div className="mt-2 border-t border-border/50 pt-2">
            <button
              type="button"
              onClick={handleClearOverride}
              className="w-full rounded-sm px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              Clear project override (use global default)
            </button>
          </div>
        ) : (
          <div className="mt-2 border-t border-border/50 pt-2 px-2">
            <p className="text-[11px] text-muted-foreground">
              Selecting a profile sets it as the default for this project.
            </p>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
