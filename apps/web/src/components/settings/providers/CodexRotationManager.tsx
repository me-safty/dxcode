"use client";

import type { CodexAccountConfig, CodexUsageSnapshot, CodexUsageWindow } from "@t3tools/contracts";
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import {
  codexUsageWindowLabel,
  compactCodexUsage,
  formatCodexUsageReset,
  remainingCodexPercent,
} from "../../../lib/codexUsage";
import { probeCodexAccountUsage } from "../../../lib/codexUsageProbe";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import {
  buildCodexAccountSwitchConfig,
  readCodexAccountState,
  sameImportedCodexAccount,
} from "../../../lib/codexAccounts";
import { BulkAddAccountsDialog } from "./BulkAddAccountsDialog";

interface CodexRotationManagerProps {
  config: Record<string, unknown>;
  onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

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
        <span>{remaining}% left</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${remaining}%` }} />
      </div>
    </div>
  );
}

export function CodexRotationManager({ config, onChange }: CodexRotationManagerProps) {
  const { enableAutoRotation, secondaryAccounts, binaryPath, activeShadowHomePath, activeAccount } =
    readCodexAccountState(config);

  const [usageStats, setUsageStats] = useState<Record<string, UsageState>>({});
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [syncingUsage, setSyncingUsage] = useState(false);

  const updateConfig = (updates: Partial<Record<string, unknown>>) => {
    onChange({ ...config, ...updates });
  };

  const handleCheckUsage = async (account: CodexAccountConfig) => {
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
        binaryPath,
      });
      if (result.status === "success" && result.usage) {
        const usage = result.usage;
        const resolvedHomePath = result.resolvedHomePath;
        setUsageStats((previous) => ({
          ...previous,
          [account.id]: {
            loading: false,
            data: usage,
            ...(resolvedHomePath ? { resolvedHomePath } : {}),
          },
        }));
        return;
      }
      const resolvedHomePath = result.resolvedHomePath;
      setUsageStats((previous) => ({
        ...previous,
        [account.id]: {
          loading: false,
          ...(resolvedHomePath ? { resolvedHomePath } : {}),
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
  };

  const handleSyncUsage = async () => {
    setSyncingUsage(true);
    try {
      for (const account of [activeAccount, ...secondaryAccounts]) {
        await handleCheckUsage(account);
      }
    } finally {
      setSyncingUsage(false);
    }
  };

  const handleAddAccount = () => {
    const id = `acct_${Date.now()}`;
    const newAccount: CodexAccountConfig = {
      id,
      label: `Account ${secondaryAccounts.length + 1}`,
      shadowHomePath: `~/.t3/codex/shadow_${id}`,
      enabled: true,
    };
    updateConfig({ secondaryAccounts: [...secondaryAccounts, newAccount] });
  };

  const handleAddAccounts = (accounts: ReadonlyArray<CodexAccountConfig>) => {
    const withoutReimportedProfiles = secondaryAccounts.filter(
      (existing) => !accounts.some((incoming) => sameImportedCodexAccount(existing, incoming)),
    );
    if (!activeShadowHomePath && accounts[0]) {
      const [nextActive, ...backups] = accounts;
      updateConfig({
        activeAccountId: nextActive.id,
        activeAccountLabel: nextActive.label,
        shadowHomePath: nextActive.shadowHomePath,
        ...(nextActive.authSourceHomePath
          ? { authSourceHomePath: nextActive.authSourceHomePath }
          : {}),
        secondaryAccounts: [...backups, ...withoutReimportedProfiles],
      });
      return;
    }
    updateConfig({
      secondaryAccounts: [...accounts, ...withoutReimportedProfiles],
    });
  };

  const handleSwitchAccount = (accountId: string | null) => {
    const nextConfig = buildCodexAccountSwitchConfig({
      config,
      accountId,
      resolvedHomePath: accountId ? usageStats[accountId]?.resolvedHomePath : undefined,
    });
    if (nextConfig) onChange(nextConfig);
  };

  const handleUpdateAccount = (id: string, updates: Partial<CodexAccountConfig>) => {
    updateConfig({
      secondaryAccounts: secondaryAccounts.map((account) =>
        account.id === id ? { ...account, ...updates } : account,
      ),
    });
  };

  const handleRemoveAccount = (id: string) => {
    updateConfig({
      secondaryAccounts: secondaryAccounts.filter((account) => account.id !== id),
    });
  };

  const activeUsage = usageStats[activeAccount.id];
  const activeDisplayName = activeUsage?.data?.email ?? activeAccount.label;

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">Active Codex account</h3>
            <p className="text-xs text-muted-foreground">
              Switch manually or sync every account to compare current limits.
            </p>
          </div>
          <Button
            className="h-7 shrink-0 text-xs"
            disabled={syncingUsage}
            onClick={() => void handleSyncUsage()}
            size="sm"
            variant="outline"
          >
            {syncingUsage ? (
              <Loader2Icon className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="mr-1 h-3 w-3" />
            )}
            Sync usage
          </Button>
        </div>
        <Select value={activeAccount.id} onValueChange={handleSwitchAccount}>
          <SelectTrigger aria-label="Active Codex account" className="min-h-12 w-full">
            <SelectValue>
              <div className="flex min-w-0 items-center justify-between gap-3 pr-2">
                <div className="min-w-0 text-left">
                  <div className="truncate text-sm font-medium">{activeDisplayName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {activeUsage?.loading
                      ? "Checking usage…"
                      : compactCodexUsage(activeUsage?.data)}
                  </div>
                </div>
                {activeUsage?.data?.planType ? (
                  <Badge className="shrink-0 text-[10px]" variant="secondary">
                    {activeUsage.data.planType}
                  </Badge>
                ) : null}
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false} className="min-w-[340px]" sideOffset={6}>
            {[activeAccount, ...secondaryAccounts].map((account) => {
              const usage = usageStats[account.id];
              const displayName = usage?.data?.email ?? account.label;
              return (
                <SelectItem className="min-h-12 py-2" key={account.id} value={account.id}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{displayName}</span>
                        {account.id === activeAccount.id ? (
                          <CheckIcon className="size-3 text-primary" />
                        ) : null}
                        {!account.enabled ? (
                          <Badge className="text-[9px]" variant="secondary">
                            Auto-rotation off
                          </Badge>
                        ) : null}
                      </div>
                      <div
                        className={
                          usage?.error
                            ? "truncate text-[10px] text-destructive"
                            : "truncate text-[10px] text-muted-foreground"
                        }
                        title={usage?.error}
                      >
                        {usage?.loading
                          ? "Checking usage…"
                          : (usage?.error ?? compactCodexUsage(usage?.data))}
                      </div>
                    </div>
                    {usage?.data?.planType ? (
                      <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                        {usage.data.planType}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        {activeUsage?.data ? (
          <div className="flex gap-3 rounded-md border bg-muted/25 p-2.5">
            <UsageMeter
              label={codexUsageWindowLabel(activeUsage.data.primary, "5h")}
              window={activeUsage.data.primary}
            />
            <UsageMeter
              label={codexUsageWindowLabel(activeUsage.data.secondary, "Weekly")}
              window={activeUsage.data.secondary}
            />
          </div>
        ) : null}
        {activeUsage?.error ? (
          <p className="text-xs text-destructive">{activeUsage.error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Auto-rotation</h3>
          <p className="text-xs text-muted-foreground">
            Switch to the next enabled backup when Codex reports a depleted limit.
          </p>
        </div>
        <Switch
          checked={enableAutoRotation}
          onCheckedChange={(checked) => updateConfig({ enableAutoRotation: checked })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">Backup accounts</h3>
          <div className="flex gap-2">
            <Button
              className="h-7 text-xs"
              onClick={() => setShowBulkAdd(true)}
              size="sm"
              variant="secondary"
            >
              Enroll / import
            </Button>
            <Button className="h-7 text-xs" onClick={handleAddAccount} size="sm" variant="outline">
              <PlusIcon className="mr-1 h-3 w-3" />
              Add account
            </Button>
          </div>
        </div>

        {showBulkAdd ? (
          <BulkAddAccountsDialog
            binaryPath={binaryPath}
            onAddAccounts={handleAddAccounts}
            onClose={() => setShowBulkAdd(false)}
          />
        ) : null}

        {secondaryAccounts.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No backup accounts configured. Import accounts to enable rotation.
          </div>
        ) : (
          <div className="grid gap-3">
            {secondaryAccounts.map((account) => {
              const usage = usageStats[account.id];
              const loginHomePath = account.authSourceHomePath ?? account.shadowHomePath;
              return (
                <div
                  className="flex flex-col gap-2 rounded-md border bg-card/50 p-3"
                  key={account.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Switch
                        checked={account.enabled}
                        onCheckedChange={(checked) =>
                          handleUpdateAccount(account.id, { enabled: checked })
                        }
                      />
                      <Input
                        className="h-7 w-[180px] border-none bg-transparent text-xs font-medium focus-visible:ring-1"
                        onChange={(event) =>
                          handleUpdateAccount(account.id, { label: event.target.value })
                        }
                        placeholder="Account label"
                        value={account.label}
                      />
                      {!account.enabled ? (
                        <Badge className="text-[10px]" variant="secondary">
                          Disabled
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        className="h-6 w-6"
                        disabled={usage?.loading}
                        onClick={() => void handleCheckUsage(account)}
                        size="icon"
                        title="Refresh usage"
                        variant="ghost"
                      >
                        {usage?.loading ? (
                          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCwIcon className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveAccount(account.id)}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {usage?.data ? (
                    <div className="flex gap-3 rounded-sm bg-muted/40 p-2">
                      <UsageMeter
                        label={codexUsageWindowLabel(usage.data.primary, "5h")}
                        window={usage.data.primary}
                      />
                      <UsageMeter
                        label={codexUsageWindowLabel(usage.data.secondary, "Weekly")}
                        window={usage.data.secondary}
                      />
                    </div>
                  ) : null}
                  {usage?.error ? (
                    <p className="truncate text-[10px] text-destructive" title={usage.error}>
                      {usage.error}
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                    <code className="min-w-0 truncate rounded bg-muted/40 px-1 py-0.5">
                      {account.authSourceHomePath
                        ? `Imported from ${account.authSourceHomePath}`
                        : account.shadowHomePath}
                    </code>
                    {!account.authSourceHomePath ? (
                      <Button
                        className="h-5 w-5 shrink-0"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            `env CODEX_HOME=${loginHomePath} ${binaryPath} login`,
                          )
                        }
                        size="icon"
                        title="Copy login command"
                        variant="ghost"
                      >
                        <CopyIcon className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
