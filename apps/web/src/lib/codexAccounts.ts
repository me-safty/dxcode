import type { CodexAccountConfig } from "@t3tools/contracts";

export const FALLBACK_ACTIVE_CODEX_ACCOUNT_ID = "__active_codex_account__";

export interface CodexAccountState {
  readonly config: Record<string, unknown>;
  readonly enableAutoRotation: boolean;
  readonly secondaryAccounts: ReadonlyArray<CodexAccountConfig>;
  readonly binaryPath: string;
  readonly activeShadowHomePath?: string | undefined;
  readonly activeHomePath: string;
  readonly activeAuthSourceHomePath?: string | undefined;
  readonly activeAccount: CodexAccountConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexAccountConfig(value: unknown): value is CodexAccountConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.shadowHomePath === "string" &&
    typeof value.enabled === "boolean" &&
    (value.authSourceHomePath === undefined || typeof value.authSourceHomePath === "string")
  );
}

export function codexConfigRecord(config: unknown): Record<string, unknown> {
  return isRecord(config) ? config : {};
}

export function readCodexConfigString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function managedCodexAccountHomePath(accountId: string): string {
  const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `~/.t3/codex/accounts/${safeId}`;
}

export function codexProfileLabel(profileHomePath: string, index: number): string {
  const parts = profileHomePath.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1);
  const profileName = last === "codex-home" ? parts.at(-2) : last;
  return profileName?.trim() || `Imported account ${index + 1}`;
}

export function importedCodexAccounts(
  profileHomePaths: ReadonlyArray<string>,
  timestamp = Date.now(),
): ReadonlyArray<CodexAccountConfig> {
  return profileHomePaths.map((authSourceHomePath, index) => {
    const id = `acct_${timestamp}_${index}`;
    return {
      id,
      label: codexProfileLabel(authSourceHomePath, index),
      shadowHomePath: managedCodexAccountHomePath(id),
      authSourceHomePath,
      enabled: true,
    };
  });
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/$/, "");
}

export function sameImportedCodexAccount(
  left: CodexAccountConfig,
  right: CodexAccountConfig,
): boolean {
  const leftPath = normalizedPath(left.authSourceHomePath ?? left.shadowHomePath);
  const rightPath = normalizedPath(right.authSourceHomePath ?? right.shadowHomePath);
  return (
    leftPath === rightPath ||
    `${leftPath}/codex-home` === rightPath ||
    `${rightPath}/codex-home` === leftPath
  );
}

export function readCodexAccountState(configInput: unknown): CodexAccountState {
  const config = codexConfigRecord(configInput);
  const secondaryAccounts = Array.isArray(config.secondaryAccounts)
    ? config.secondaryAccounts.filter(isCodexAccountConfig)
    : [];
  const activeShadowHomePath = readCodexConfigString(config, "shadowHomePath");
  const activeAuthSourceHomePath = readCodexConfigString(config, "authSourceHomePath");
  const activeHomePath =
    activeShadowHomePath ?? readCodexConfigString(config, "homePath") ?? "~/.codex";
  const activeAccount: CodexAccountConfig = {
    id: readCodexConfigString(config, "activeAccountId") ?? FALLBACK_ACTIVE_CODEX_ACCOUNT_ID,
    label:
      readCodexConfigString(config, "activeAccountLabel") ??
      (activeShadowHomePath ? "Current Codex account" : "Default Codex account"),
    shadowHomePath: activeHomePath,
    ...(activeAuthSourceHomePath ? { authSourceHomePath: activeAuthSourceHomePath } : {}),
    enabled: true,
  };

  return {
    config,
    enableAutoRotation: config.enableAutoRotation === true,
    secondaryAccounts,
    binaryPath: readCodexConfigString(config, "binaryPath") ?? "codex",
    ...(activeShadowHomePath ? { activeShadowHomePath } : {}),
    activeHomePath,
    ...(activeAuthSourceHomePath ? { activeAuthSourceHomePath } : {}),
    activeAccount,
  };
}

export function buildCodexAccountSwitchConfig(input: {
  readonly config: unknown;
  readonly accountId: string | null | undefined;
  readonly resolvedHomePath?: string | undefined;
  readonly timestamp?: number | undefined;
}): Record<string, unknown> | undefined {
  const state = readCodexAccountState(input.config);
  if (!input.accountId || input.accountId === state.activeAccount.id) return undefined;

  const selected = state.secondaryAccounts.find((account) => account.id === input.accountId);
  if (!selected) return undefined;

  const inferredImportedSource =
    !selected.authSourceHomePath &&
    input.resolvedHomePath &&
    /[\\/]codex-home$/.test(input.resolvedHomePath) &&
    !/[\\/]codex-home$/.test(selected.shadowHomePath)
      ? input.resolvedHomePath
      : undefined;
  const authSourceHomePath = selected.authSourceHomePath ?? inferredImportedSource;
  const selectedShadowHomePath = authSourceHomePath
    ? managedCodexAccountHomePath(selected.id)
    : selected.shadowHomePath;
  const nextSecondaryAccounts = state.secondaryAccounts.filter(
    (account) => account.id !== selected.id,
  );

  if (state.activeShadowHomePath) {
    nextSecondaryAccounts.unshift({
      id:
        state.activeAccount.id === FALLBACK_ACTIVE_CODEX_ACCOUNT_ID
          ? `acct_previous_${input.timestamp ?? Date.now()}`
          : state.activeAccount.id,
      label: state.activeAccount.label,
      shadowHomePath: state.activeShadowHomePath,
      ...(state.activeAccount.authSourceHomePath
        ? { authSourceHomePath: state.activeAccount.authSourceHomePath }
        : {}),
      enabled: true,
    });
  }

  const { authSourceHomePath: _previousSource, ...configWithoutPreviousSource } = state.config;
  return {
    ...configWithoutPreviousSource,
    activeAccountId: selected.id,
    activeAccountLabel: selected.label,
    shadowHomePath: selectedShadowHomePath,
    ...(authSourceHomePath ? { authSourceHomePath } : {}),
    secondaryAccounts: nextSecondaryAccounts,
  };
}
