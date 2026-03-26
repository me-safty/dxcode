import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  skills: (binaryPath: string, homePath: string, cwd: string | null) =>
    ["server", "skills", binaryPath, homePath, cwd] as const,
  providerCommands: (provider: string) => ["server", "provider-commands", provider] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function serverSkillsQueryOptions(
  binaryPath: string,
  homePath: string,
  cwd?: string | null,
) {
  return queryOptions({
    queryKey: serverQueryKeys.skills(binaryPath, homePath, cwd ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      const trimmedBinaryPath = binaryPath.trim();
      const trimmedHomePath = homePath.trim();
      const trimmedCwd = cwd?.trim() ?? "";
      return api.server.listSkills(
        trimmedBinaryPath.length > 0 || trimmedHomePath.length > 0 || trimmedCwd.length > 0
          ? {
              ...(trimmedBinaryPath.length > 0 ? { binaryPath } : {}),
              ...(trimmedHomePath.length > 0 ? { homePath } : {}),
              ...(trimmedCwd.length > 0 ? { cwd: trimmedCwd } : {}),
            }
          : undefined,
      );
    },
    staleTime: 15_000,
  });
}

export function serverProviderCommandsQueryOptions(provider: "codex" | "claudeAgent") {
  return queryOptions({
    queryKey: serverQueryKeys.providerCommands(provider),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listProviderCommands({ provider });
    },
    staleTime: 60_000,
  });
}
