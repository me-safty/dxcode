import { ChevronDownIcon, GaugeIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ensureLocalApi } from "../../localApi";
import type { AppState } from "../../store";
import { useStore } from "../../store";
import { useServerProviders } from "../../rpc/serverState";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { useSidebar } from "../ui/sidebar";
import {
  deriveSidebarUsageProviderRows,
  getSidebarUsagePrimaryWindow,
  getSidebarUsageSummary,
  type SidebarUsageContextSnapshot,
  type SidebarUsageCostSnapshot,
  type SidebarUsageSummary,
  type SidebarUsageProviderRow,
  type SidebarUsageThreadInput,
  type SidebarUsageWindow,
} from "./SidebarUsageIndicator.logic";

const SIDEBAR_USAGE_EXPANDED_STORAGE_KEY = "t3code:sidebar-usage-expanded:v1";

function collectSidebarUsageThreads(
  environmentStateById: AppState["environmentStateById"],
): SidebarUsageThreadInput[] {
  const threads: SidebarUsageThreadInput[] = [];

  for (const environmentState of Object.values(environmentStateById)) {
    for (const threadId of environmentState.threadIds) {
      const shell = environmentState.threadShellById[threadId];
      const activityIds = environmentState.activityIdsByThreadId[threadId];
      const activityById = environmentState.activityByThreadId[threadId];
      if (!shell || !activityIds || activityIds.length === 0 || !activityById) {
        continue;
      }

      const activities = activityIds.flatMap((activityId) => {
        const activity = activityById[activityId];
        return activity ? [activity] : [];
      });
      if (activities.length === 0) {
        continue;
      }

      const session = environmentState.threadSessionById[threadId] ?? null;
      threads.push({
        id: threadId,
        title: shell.title,
        modelSelectionInstanceId: shell.modelSelection.instanceId,
        sessionProvider: session?.provider,
        sessionProviderInstanceId: session?.providerInstanceId,
        activities,
      });
    }
  }

  return threads;
}

function formatUsagePrimary(window: SidebarUsageWindow | null): string {
  if (!window) {
    return "--";
  }
  if (typeof window.remainingPercent === "number") {
    return `${Math.round(window.remainingPercent)}%`;
  }
  if (window.status === "rejected") {
    return "Limited";
  }
  if (window.status === "allowed_warning") {
    return "Warn";
  }
  if (window.status === "allowed") {
    return "OK";
  }
  return "Updated";
}

function formatResetDistance(resetsAtMs: number | null): string | null {
  if (resetsAtMs === null) {
    return null;
  }
  const remainingMs = resetsAtMs - Date.now();
  if (remainingMs <= 0) {
    return "resetting";
  }
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m left`;
  }
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) {
    return `${hours}h left`;
  }
  return `${Math.ceil(hours / 24)}d left`;
}

function formatUsageDetail(window: SidebarUsageWindow | null): string {
  if (!window) {
    return "No data";
  }
  const reset = formatResetDistance(window.resetsAtMs);
  if (reset) {
    return reset;
  }
  if (window.status) {
    return window.status.replaceAll("_", " ");
  }
  return "Updated";
}

function formatCostUsd(totalUsd: number): string {
  if (totalUsd >= 100) {
    return `$${Math.round(totalUsd)}`;
  }
  if (totalUsd >= 10) {
    return `$${totalUsd.toFixed(1).replace(/\.0$/, "")}`;
  }
  if (totalUsd >= 0.01) {
    return `$${totalUsd.toFixed(2)}`;
  }
  if (totalUsd > 0) {
    return "<$0.01";
  }
  return "$0";
}

function formatCostPrimary(cost: SidebarUsageCostSnapshot | null): string {
  if (!cost) {
    return "--";
  }
  return formatCostUsd(cost.totalUsd);
}

function formatContextPrimary(context: SidebarUsageContextSnapshot | null): string {
  if (!context) {
    return "--";
  }
  if (context.remainingPercent !== null) {
    return `${Math.round(context.remainingPercent)}%`;
  }
  return formatContextWindowTokens(context.usedTokens);
}

function formatContextDetail(context: SidebarUsageContextSnapshot | null): string {
  if (!context) {
    return "No context data";
  }
  if (context.usedPercent !== null) {
    return `${Math.round(context.usedPercent)}% used`;
  }
  if (context.maxTokens !== null) {
    return `${formatContextWindowTokens(context.usedTokens)} / ${formatContextWindowTokens(
      context.maxTokens,
    )}`;
  }
  return `${formatContextWindowTokens(context.usedTokens)} used`;
}

function formatSummary(
  summary: SidebarUsageSummary | null,
  costRow: SidebarUsageProviderRow | null,
): string {
  if (summary) {
    return `${summary.row.label} ${summary.window.label} ${formatUsagePrimary(summary.window)}`;
  }
  if (costRow?.cost) {
    return `${costRow.label} ${formatCostPrimary(costRow.cost)} spent`;
  }
  if (costRow?.context) {
    return `${costRow.label} context ${formatContextPrimary(costRow.context)}`;
  }
  return "No limit data";
}

function formatProviderTitle(
  row: SidebarUsageProviderRow,
  primaryWindow: SidebarUsageWindow | null,
): string {
  const detail = primaryWindow
    ? `${primaryWindow.label} ${formatUsagePrimary(primaryWindow)}, ${formatUsageDetail(
        primaryWindow,
      )}`
    : row.cost
      ? `${formatCostPrimary(row.cost)} spent across ${row.cost.threadCount} thread${
          row.cost.threadCount === 1 ? "" : "s"
        }`
      : row.context
        ? `Context ${formatContextDetail(row.context)}`
        : "No limit data yet";
  return row.threadTitle
    ? `${row.label}: ${detail} in ${row.threadTitle}`
    : `${row.label}: ${detail}`;
}

function usageBarColor(row: SidebarUsageProviderRow, window: SidebarUsageWindow | null): string {
  const remainingPercent = window?.remainingPercent;
  if (window?.status === "rejected" || (remainingPercent != null && remainingPercent <= 5)) {
    return "bg-destructive";
  }
  if (
    window?.status === "allowed_warning" ||
    (remainingPercent != null && remainingPercent <= 20)
  ) {
    return "bg-amber-500";
  }
  return row.driverId === "claudeAgent" ? "bg-[#d97757]" : "bg-muted-foreground";
}

function SidebarUsageWindowMeter({
  row,
  window,
  fallbackLabel,
}: {
  row: SidebarUsageProviderRow;
  window: SidebarUsageWindow | null;
  fallbackLabel: string;
}) {
  const normalizedPercentage = Math.max(0, Math.min(100, window?.remainingPercent ?? 0));

  return (
    <div className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-1">
        <span className="truncate text-[10px] font-medium text-muted-foreground/80">
          {window?.label ?? fallbackLabel}
        </span>
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-foreground">
          {formatUsagePrimary(window)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-background/80">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            usageBarColor(row, window),
          )}
          style={{ width: `${normalizedPercentage}%` }}
        />
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground/70">
        {formatUsageDetail(window)}
      </div>
    </div>
  );
}

function SidebarUsageCostCard({
  row,
  cost,
}: {
  row: SidebarUsageProviderRow;
  cost: SidebarUsageCostSnapshot | null;
}) {
  const accentColor = row.driverId === "claudeAgent" ? "text-[#d97757]" : "text-foreground";
  return (
    <div className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-1">
        <span className="truncate text-[10px] font-medium text-muted-foreground/80">Spent</span>
        <span className={cn("shrink-0 text-[10px] font-medium tabular-nums", accentColor)}>
          {formatCostPrimary(cost)}
        </span>
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground/70">
        {cost
          ? `${cost.threadCount} thread${cost.threadCount === 1 ? "" : "s"}`
          : "No subscription — spend pending"}
      </div>
    </div>
  );
}

function SidebarUsageContextCard({
  row,
  context,
}: {
  row: SidebarUsageProviderRow;
  context: SidebarUsageContextSnapshot | null;
}) {
  const accentColor = row.driverId === "claudeAgent" ? "text-[#d97757]" : "text-foreground";
  const normalizedPercentage =
    context?.remainingPercent === null || context?.remainingPercent === undefined
      ? 0
      : Math.max(0, Math.min(100, context.remainingPercent));
  return (
    <div className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-1">
        <span className="truncate text-[10px] font-medium text-muted-foreground/80">Context</span>
        <span className={cn("shrink-0 text-[10px] font-medium tabular-nums", accentColor)}>
          {formatContextPrimary(context)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-background/80">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            usageBarColor(row, null),
          )}
          style={{ width: `${normalizedPercentage}%` }}
        />
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground/70">
        {formatContextDetail(context)}
      </div>
    </div>
  );
}

function SidebarUsageDetailsGrid({ row }: { row: SidebarUsageProviderRow }) {
  const detailCards: ReactNode[] = [];

  if (row.windows.fiveHour) {
    detailCards.push(
      <SidebarUsageWindowMeter
        key="fiveHour"
        row={row}
        window={row.windows.fiveHour}
        fallbackLabel="5h"
      />,
    );
  }
  if (row.windows.weekly) {
    detailCards.push(
      <SidebarUsageWindowMeter
        key="weekly"
        row={row}
        window={row.windows.weekly}
        fallbackLabel="Week"
      />,
    );
  }
  if (detailCards.length < 2 && row.context) {
    detailCards.push(<SidebarUsageContextCard key="context" row={row} context={row.context} />);
  }
  if (detailCards.length < 2 && row.cost) {
    detailCards.push(<SidebarUsageCostCard key="cost" row={row} cost={row.cost} />);
  }
  if (detailCards.length === 0) {
    detailCards.push(
      <SidebarUsageWindowMeter key="fiveHour-empty" row={row} window={null} fallbackLabel="5h" />,
    );
  }
  if (detailCards.length < 2) {
    const missingLabel = row.windows.fiveHour ? "Week" : "5h";
    detailCards.push(
      <SidebarUsageWindowMeter
        key={`${missingLabel}-empty`}
        row={row}
        window={null}
        fallbackLabel={missingLabel}
      />,
    );
  }

  return <div className="grid grid-cols-2 gap-1.5">{detailCards.slice(0, 2)}</div>;
}

function SidebarUsageProviderRowView({ row }: { row: SidebarUsageProviderRow }) {
  const primaryWindow = getSidebarUsagePrimaryWindow(row);
  const title = formatProviderTitle(row, primaryWindow);
  const hasRateLimitWindows = row.windows.fiveHour !== null || row.windows.weekly !== null;
  const primaryLabel = hasRateLimitWindows
    ? formatUsagePrimary(primaryWindow)
    : row.cost
      ? formatCostPrimary(row.cost)
      : formatContextPrimary(row.context);

  return (
    <div className="grid gap-1 rounded-md px-2 py-1.5" title={title}>
      <div className="flex min-w-0 items-center gap-2">
        <ProviderInstanceIcon
          driverKind={row.driverKind}
          displayName={row.label}
          className="size-4"
          iconClassName="size-3.5"
        />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">{row.label}</span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-foreground">
          {primaryLabel}
        </span>
      </div>
      {hasRateLimitWindows ? (
        <SidebarUsageDetailsGrid row={row} />
      ) : row.cost ? (
        <SidebarUsageCostCard row={row} cost={row.cost} />
      ) : (
        <SidebarUsageContextCard row={row} context={row.context} />
      )}
    </div>
  );
}

export function SidebarUsageIndicator() {
  const [expanded, setExpanded] = useLocalStorage(
    SIDEBAR_USAGE_EXPANDED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const environmentStateById = useStore((state) => state.environmentStateById);
  const providers = useServerProviders();
  const { isMobile, open, openMobile } = useSidebar();
  const sidebarVisible = isMobile ? openMobile : open;
  const previousSidebarVisibleRef = useRef(false);

  const threads = useMemo(
    () => collectSidebarUsageThreads(environmentStateById),
    [environmentStateById],
  );
  const rows = useMemo(
    () =>
      deriveSidebarUsageProviderRows({
        providerInstances: providers.map((provider) => ({
          instanceId: provider.instanceId,
          driverKind: provider.driver,
        })),
        threads,
      }),
    [providers, threads],
  );
  const summary = useMemo(() => getSidebarUsageSummary(rows), [rows]);
  const fallbackRow = useMemo(() => {
    if (summary) {
      return null;
    }
    for (const row of rows) {
      if (
        row.windows.fiveHour === null &&
        row.windows.weekly === null &&
        (row.cost || row.context)
      ) {
        return row;
      }
    }
    return null;
  }, [rows, summary]);

  useEffect(() => {
    const previousSidebarVisible = previousSidebarVisibleRef.current;
    previousSidebarVisibleRef.current = sidebarVisible;
    if (!sidebarVisible || (previousSidebarVisible && !expanded)) {
      return;
    }

    void ensureLocalApi()
      .server.refreshUsageLimits()
      .catch(() => undefined);
  }, [expanded, sidebarVisible]);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        aria-label={expanded ? "Collapse usage" : "Expand usage"}
        className="flex h-7 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-muted-foreground/70 outline-hidden ring-ring transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2"
      >
        <GaugeIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs">Usage</span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          {formatSummary(summary, fallbackRow)}
        </span>
        <ChevronDownIcon
          className={cn("size-3 shrink-0 transition-transform", expanded ? "rotate-180" : "")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-1 pt-1">
          {rows.map((row) => (
            <SidebarUsageProviderRowView key={row.driverId} row={row} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
