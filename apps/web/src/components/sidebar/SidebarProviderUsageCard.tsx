import { RefreshCwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

import { ensureLocalApi } from "../../localApi";
import {
  formatProviderUsagePercent,
  formatProviderUsageResetAt,
  orderProviderUsageWindows,
  shortProviderPlanLabel,
} from "../../lib/providerUsage";
import { useServerProviders } from "../../rpc/serverState";
import { Spinner } from "../ui/spinner";

const PROVIDER_ORDER = ["codex", "claudeAgent"] as const;
const PROVIDER_LABELS: Record<(typeof PROVIDER_ORDER)[number], string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};
type ProviderUsageState = NonNullable<ServerProvider["usage"]>["state"] | "unavailable";

function providerDisplayLabel(providerKind: ServerProvider["provider"]): string {
  switch (providerKind) {
    case "codex":
      return PROVIDER_LABELS.codex;
    case "claudeAgent":
      return PROVIDER_LABELS.claudeAgent;
    default:
      return providerKind;
  }
}

function providerStatusMessage(provider: ServerProvider): string {
  if (!provider.usage) {
    if (!provider.enabled) {
      return "Disabled in settings.";
    }
    return provider.message ?? "Usage data has not been reported yet.";
  }

  if (provider.usage.state === "syncing") {
    return provider.usage.message ?? "Syncing usage limits...";
  }

  if (provider.usage.state === "unavailable") {
    return provider.usage.message ?? provider.message ?? "Usage data is unavailable.";
  }

  if (provider.usage.windows.length === 0) {
    return provider.usage.message ?? "No usage windows were reported.";
  }

  return provider.usage.message ?? "";
}

function usageBarClass(state: ProviderUsageState, window: ServerProviderUsageWindow): string {
  if (state === "syncing") {
    return "bg-sky-500";
  }
  if (window.level === "warning") {
    return "bg-amber-500";
  }
  if (window.level === "critical" || window.level === "exhausted") {
    return "bg-red-500";
  }
  return "bg-emerald-500";
}

function usageBarWidth(state: ProviderUsageState, percentUsed: number | null): number {
  if (typeof percentUsed === "number" && Number.isFinite(percentUsed)) {
    return Math.max(4, Math.min(100, percentUsed));
  }
  if (state === "syncing") {
    return 35;
  }
  return 0;
}

export function SidebarProviderUsageCard() {
  const providers = useServerProviders();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const knownProviders = PROVIDER_ORDER.flatMap((providerKind) => {
    const provider = providers.find((candidate) => candidate.provider === providerKind);
    return provider && (provider.enabled || provider.usage !== undefined) ? [provider] : [];
  });

  const handleRefresh = useCallback(() => {
    if (refreshingRef.current) {
      return;
    }

    refreshingRef.current = true;
    setRefreshing(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .catch(() => undefined)
      .finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
  }, []);

  if (knownProviders.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-border/70 bg-card/70 px-2.5 py-2 text-xs shadow-xs/5"
      data-testid="sidebar-provider-usage-card"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
          Usage limits
        </div>
        <button
          type="button"
          aria-label="Refresh provider usage"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={refreshing}
          onClick={handleRefresh}
        >
          {refreshing ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
        </button>
      </div>

      <div className="space-y-2.5">
        {knownProviders.map((provider) => {
          const orderedWindows = orderProviderUsageWindows(provider.usage?.windows ?? []);
          const planLabel = shortProviderPlanLabel(provider.auth.label);
          const statusMessage = providerStatusMessage(provider);
          const showFallbackMessage =
            !provider.usage ||
            provider.usage.windows.length === 0 ||
            provider.usage.state !== "available";

          return (
            <div
              key={provider.provider}
              className="space-y-1.5"
              data-provider-usage-provider={provider.provider}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-foreground">
                  {providerDisplayLabel(provider.provider)}
                </div>
                {planLabel ? (
                  <div className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {planLabel}
                  </div>
                ) : null}
              </div>

              {showFallbackMessage && statusMessage ? (
                <div className="text-[11px] leading-4 text-muted-foreground">{statusMessage}</div>
              ) : null}

              {orderedWindows.length > 0 ? (
                <div className="space-y-1.5">
                  {orderedWindows.map((window) => {
                    const resetLabel = formatProviderUsageResetAt(window.resetsAt);
                    const state = provider.usage?.state ?? "unavailable";

                    return (
                      <div
                        key={window.id}
                        className="space-y-1"
                        data-provider-usage-window={window.id}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-foreground/90">{window.label}</div>
                            {resetLabel ? (
                              <div className="text-[11px] text-muted-foreground">
                                Resets in {resetLabel}
                              </div>
                            ) : null}
                          </div>
                          <div className="shrink-0 tabular-nums text-muted-foreground">
                            {formatProviderUsagePercent(window.percentUsed)}
                          </div>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-[width] duration-200 ${usageBarClass(
                              state,
                              window,
                            )}`}
                            style={{
                              width: `${usageBarWidth(state, window.percentUsed)}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
