import type { CodexSettings } from "@t3tools/contracts";

export function buildCodexGlobalArgs(
  config: Partial<Pick<CodexSettings, "profileName" | "launchArgs">>,
) {
  return [
    ...(config.profileName ? ["-p", config.profileName] : []),
    ...(config.launchArgs?.trim().split(/\s+/).filter(Boolean) ?? []),
  ];
}
