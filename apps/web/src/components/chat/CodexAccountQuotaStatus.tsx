import {
  defaultInstanceIdForDriver,
  type CodexAccountConfig,
  type CodexUsageSnapshot,
  type CodexUsageWindow,
  type EnvironmentId,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  GaugeIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCwIcon,
  UserRoundIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { buildCodexAccountSwitchConfig, readCodexAccountState } from "../../lib/codexAccounts";
import {
  codexUsageWindowLabel,
  compactCodexUsage,
  formatCodexUsageReset,
  remainingCodexPercent,
} from "../../lib/codexUsage";
import { probeCodexAccountUsage } from "../../lib/codexUsageProbe";
import { cn } from "../../lib/utils";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildProviderInstanceUpdatePatch } from "../settings/SettingsPanels.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";

const CODEX_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface UsageState {
  readonly loading?: boolean;
  readonly data?: CodexUsageSnapshot;
  readonly resolvedHomePath?: string;
  readonly error?: string;
}

function UsageMeter({ label, window }: { label: string; window: CodexUsageWindow | undefined }) {
  const remaining = remainingCodexPercent(window);
  if (remaining === undefined) return null;
  const reset = formatCodexUsageReset(window);
  return (
    <div className="min-w-0 flex-1" title={reset ? `Resets ${reset}` : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{remaining}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${remaining}%` }} />
      </div>
    </div>
  );
}

function usageSummary(usage: CodexUsageSnapshot | undefined): string {
  if (!usage) return "Usage unavailable";
  return compactCodexUsage(usage);
}

function accountDisplayName(input: {
  readonly account: CodexAccountConfig;
  readonly active: boolean;
  readonly usage?: CodexUsageSnapshot | undefined;
  readonly provider: ServerProvider;
}): string {
  return (
    input.usage?.email ??
    (input.active
      ? (input.provider.auth.email ?? input.provider.auth.label ?? input.account.label)
      : input.account.label)
  );
}

export const CodexAccountQuotaStatus = memo(function CodexAccountQuotaStatus({
  provider,
  compact,
  environmentId,
}: {
  readonly provider: ServerProvider | null;
  readonly compact: boolean;
  readonly environmentId: EnvironmentId;
}) {
  const settings = useEnvironmentSettings(environmentId, (value) => ({
    providers: value.providers,
    providerInstances: value.providerInstances,
  }));
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRefreshingActive, setIsRefreshingActive] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [usageStats, setUsageStats] = useState<Record<string, UsageState>>({});

  const providerInstanceContext = useMemo(() => {
    if (!provider || provider.driver !== "codex") return null;
    const explicitInstance = settings.providerInstances?.[provider.instanceId];
    const isDefault = provider.instanceId === defaultInstanceIdForDriver(provider.driver);
    if (explicitInstance) {
      return { instance: explicitInstance, isDefault };
    }

    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const legacyProviders = settings.providers as Record<
      string,
      LegacyProviderSettings | undefined
    >;
    const legacyConfig = legacyProviders[provider.driver] ?? {};
    return {
      instance: {
        driver: provider.driver,
        enabled: provider.enabled,
        config: legacyConfig,
      } satisfies ProviderInstanceConfig,
      isDefault,
    };
  }, [provider, settings.providerInstances, settings.providers]);

  const accountState = useMemo(
    () => readCodexAccountState(providerInstanceContext?.instance.config),
    [providerInstanceContext?.instance.config],
  );
  const allAccounts = useMemo(
    () => [accountState.activeAccount, ...accountState.secondaryAccounts],
    [accountState.activeAccount, accountState.secondaryAccounts],
  );

  const activeUsage = provider?.driver === "codex" ? provider.accountUsage : undefined;
  const accountLabel =
    provider && provider.driver === "codex"
      ? (activeUsage?.email ?? provider.auth.email ?? provider.auth.label ?? "Codex account")
      : "Codex account";
  const primaryRemaining = remainingCodexPercent(activeUsage?.primary);
  const weeklyRemaining = remainingCodexPercent(activeUsage?.secondary);
  const primaryLabel = codexUsageWindowLabel(activeUsage?.primary, "5h");
  const weeklyLabel = codexUsageWindowLabel(activeUsage?.secondary, "7d");
  const quotaUnavailable = primaryRemaining === undefined && weeklyRemaining === undefined;

  const refreshActiveUsage = useCallback(async () => {
    if (!provider || provider.driver !== "codex" || isRefreshingActive) return;
    setIsRefreshingActive(true);
    try {
      await refreshProviders({
        environmentId,
        input: { instanceId: provider.instanceId },
      });
    } finally {
      setIsRefreshingActive(false);
    }
  }, [environmentId, isRefreshingActive, provider, refreshProviders]);

  useEffect(() => {
    if (!provider || provider.driver !== "codex") return;
    const intervalId = window.setInterval(() => {
      void refreshActiveUsage();
    }, CODEX_USAGE_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [provider, refreshActiveUsage]);

  const checkUsage = useCallback(
    async (account: CodexAccountConfig) => {
      setUsageStats((previous) => {
        const { error: _previousError, ...previousState } = previous[account.id] ?? {};
        return {
          ...previous,
          [account.id]: { ...previousState, loading: true },
        };
      });
      try {
        const result = await probeCodexAccountUsage({
          shadowHomePath: account.authSourceHomePath ?? account.shadowHomePath,
          binaryPath: accountState.binaryPath,
        });
        if (result.status === "success" && result.usage) {
          const usage = result.usage;
          setUsageStats((previous) => ({
            ...previous,
            [account.id]: {
              loading: false,
              data: usage,
              ...(result.resolvedHomePath ? { resolvedHomePath: result.resolvedHomePath } : {}),
            },
          }));
          return;
        }
        setUsageStats((previous) => ({
          ...previous,
          [account.id]: {
            loading: false,
            ...(result.resolvedHomePath ? { resolvedHomePath: result.resolvedHomePath } : {}),
            error: result.error ?? "Usage is unavailable for this account.",
          },
        }));
      } catch (cause) {
        setUsageStats((previous) => ({
          ...previous,
          [account.id]: {
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          },
        }));
      }
    },
    [accountState.binaryPath],
  );

  useEffect(() => {
    if (!isMenuOpen || !provider || provider.driver !== "codex") return;
    for (const account of accountState.secondaryAccounts) {
      const state = usageStats[account.id];
      if (!state?.data && !state?.loading && !state?.error) {
        void checkUsage(account);
      }
    }
  }, [accountState.secondaryAccounts, checkUsage, isMenuOpen, provider, usageStats]);

  const updateCodexConfig = useCallback(
    (nextConfig: Record<string, unknown>) => {
      if (!provider || provider.driver !== "codex" || !providerInstanceContext) return;
      updateSettings(
        buildProviderInstanceUpdatePatch({
          settings,
          instanceId: provider.instanceId,
          instance: {
            ...providerInstanceContext.instance,
            config: nextConfig,
          },
          driver: provider.driver,
          isDefault: providerInstanceContext.isDefault,
        }),
      );
    },
    [provider, providerInstanceContext, settings, updateSettings],
  );

  const switchAccount = useCallback(
    (accountId: string) => {
      const nextConfig = buildCodexAccountSwitchConfig({
        config: accountState.config,
        accountId,
        resolvedHomePath: usageStats[accountId]?.resolvedHomePath,
      });
      if (nextConfig) {
        updateCodexConfig(nextConfig);
      }
    },
    [accountState.config, updateCodexConfig, usageStats],
  );

  const updateAutoRotation = useCallback(
    (enabled: boolean) => {
      updateCodexConfig({ ...accountState.config, enableAutoRotation: enabled });
    },
    [accountState.config, updateCodexConfig],
  );

  const refreshAllUsage = useCallback(async () => {
    if (isRefreshingAll) return;
    setIsRefreshingAll(true);
    try {
      await refreshActiveUsage();
      for (const account of accountState.secondaryAccounts) {
        await checkUsage(account);
      }
    } finally {
      setIsRefreshingAll(false);
    }
  }, [accountState.secondaryAccounts, checkUsage, isRefreshingAll, refreshActiveUsage]);

  if (!provider || provider.driver !== "codex") return null;

  const trigger = (
    <button
      aria-label={`Codex account quota for ${accountLabel}`}
      className="inline-flex h-6 max-w-[26rem] shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground/80 data-[popup-open]:bg-accent data-[popup-open]:text-foreground/80"
      data-codex-account-quota="true"
      type="button"
    >
      <UserRoundIcon className="size-3 shrink-0" />
      <span className={compact ? "max-w-24 truncate" : "max-w-40 truncate"}>{accountLabel}</span>
      <span className="text-border">·</span>
      {isRefreshingActive ? (
        <Loader2Icon className="size-3 shrink-0 animate-spin" />
      ) : (
        <GaugeIcon className="size-3 shrink-0" />
      )}
      {quotaUnavailable ? (
        <span>Quota unavailable</span>
      ) : (
        <>
          {primaryRemaining === undefined ? null : (
            <span className="whitespace-nowrap">
              {primaryLabel} {primaryRemaining}%
            </span>
          )}
          {weeklyRemaining === undefined ? null : (
            <span className="whitespace-nowrap">
              {weeklyLabel} {weeklyRemaining}%
            </span>
          )}
        </>
      )}
      <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
    </button>
  );

  return (
    <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverPopup
        align="start"
        className="w-[28rem] max-w-[calc(100vw-1rem)] p-0"
        side="top"
        sideOffset={8}
        viewportClassName="p-0"
      >
        <div className="flex flex-col gap-2 p-2 text-xs">
          <div className="flex items-center justify-between gap-3 px-1 py-1">
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">Codex accounts</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {accountState.enableAutoRotation ? "Auto-rotate enabled" : "Auto-rotate disabled"}
              </div>
            </div>
            <Button
              aria-label="Refresh Codex usage"
              className="h-7 shrink-0 text-xs"
              disabled={isRefreshingAll}
              onClick={() => void refreshAllUsage()}
              size="sm"
              variant="outline"
            >
              {isRefreshingAll ? (
                <Loader2Icon className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCwIcon className="h-3 w-3" />
              )}
              Refresh
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <RotateCwIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium text-foreground">Auto-rotate</span>
            </div>
            <Switch
              checked={accountState.enableAutoRotation}
              onCheckedChange={updateAutoRotation}
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            <div className="flex flex-col gap-1">
              {allAccounts.map((account) => {
                const active = account.id === accountState.activeAccount.id;
                const state: UsageState | undefined = active
                  ? {
                      loading: isRefreshingActive,
                      ...(activeUsage ? { data: activeUsage } : {}),
                    }
                  : usageStats[account.id];
                const usage = state?.data;
                const displayName = accountDisplayName({ account, active, usage, provider });
                const summary = state?.loading
                  ? "Checking usage..."
                  : (state?.error ?? usageSummary(usage));
                const primary = usage?.primary;
                const secondary = usage?.secondary;
                const canSwitch = !active;

                return (
                  <div
                    className={cn(
                      "rounded-md border border-transparent bg-transparent p-2",
                      active ? "border-primary/30 bg-primary/5" : "hover:bg-muted/35",
                    )}
                    key={account.id}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <button
                        className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
                        disabled={!canSwitch}
                        onClick={() => switchAccount(account.id)}
                        type="button"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium text-foreground">
                            {displayName}
                          </span>
                          {active ? <CheckIcon className="size-3 shrink-0 text-primary" /> : null}
                          {!account.enabled ? (
                            <span className="shrink-0 rounded-sm bg-muted px-1 text-[9px] text-muted-foreground">
                              skipped
                            </span>
                          ) : null}
                          {usage?.planType ? (
                            <span className="shrink-0 rounded-sm bg-secondary px-1 text-[9px] uppercase text-secondary-foreground">
                              {usage.planType}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 truncate text-[11px]",
                            state?.error ? "text-destructive" : "text-muted-foreground",
                          )}
                          title={state?.error}
                        >
                          {summary}
                        </div>
                      </button>
                      <Button
                        aria-label={`Refresh usage for ${displayName}`}
                        className="h-6 w-6 shrink-0"
                        disabled={state?.loading}
                        onClick={() =>
                          active ? void refreshActiveUsage() : void checkUsage(account)
                        }
                        size="icon"
                        variant="ghost"
                      >
                        {state?.loading ? (
                          <Loader2Icon className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCwIcon className="h-3 w-3" />
                        )}
                      </Button>
                    </div>

                    {primary || secondary ? (
                      <div className="mt-2 flex gap-3">
                        <UsageMeter label={codexUsageWindowLabel(primary, "5h")} window={primary} />
                        <UsageMeter
                          label={codexUsageWindowLabel(secondary, "7d")}
                          window={secondary}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
