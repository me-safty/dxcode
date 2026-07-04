import type { CodexUsageSnapshot, CodexUsageWindow } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";

function compactUsageWindow(
  window:
    | {
        readonly usedPercent: number;
        readonly resetsAt?: number | null;
        readonly windowDurationMins?: number | null;
      }
    | null
    | undefined,
): CodexUsageWindow | undefined {
  if (!window) return undefined;
  return {
    usedPercent: window.usedPercent,
    ...(window.resetsAt === null || window.resetsAt === undefined
      ? {}
      : { resetsAt: window.resetsAt }),
    ...(window.windowDurationMins === null || window.windowDurationMins === undefined
      ? {}
      : { windowDurationMins: window.windowDurationMins }),
  };
}

export function normalizeCodexUsage(input: {
  readonly account: CodexSchema.V2GetAccountResponse["account"];
  readonly rateLimits: CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"];
}): CodexUsageSnapshot {
  const primary = compactUsageWindow(input.rateLimits.primary);
  const secondary = compactUsageWindow(input.rateLimits.secondary);
  const account = input.account;
  const planType =
    input.rateLimits.planType ?? (account?.type === "chatgpt" ? account.planType : undefined);
  return {
    ...(account?.type === "chatgpt" ? { email: account.email } : {}),
    ...(planType ? { planType } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(input.rateLimits.rateLimitReachedType
      ? { rateLimitReachedType: input.rateLimits.rateLimitReachedType }
      : {}),
  };
}
