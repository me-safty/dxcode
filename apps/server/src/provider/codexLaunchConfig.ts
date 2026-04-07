import type { ProviderKind } from "@t3tools/contracts";
import type { CodexSettings, GlmSettings } from "@t3tools/contracts/settings";

export interface CodexLaunchConfig {
  readonly binaryPath: string;
  readonly homePath: string | undefined;
  readonly configOverrides: ReadonlyArray<string>;
  readonly extraEnv: Readonly<Record<string, string>>;
}

export type CodexLaunchPurpose = "chat-session" | "git-text-generation" | "provider-probe";

export function buildCodexSpawnEnv(config: CodexLaunchConfig): Record<string, string | undefined> {
  return {
    ...process.env,
    ...(config.homePath ? { CODEX_HOME: config.homePath } : {}),
    ...config.extraEnv,
  };
}

export function configOverridesToArgs(overrides: ReadonlyArray<string>): string[] {
  return overrides.flatMap((override) => ["-c", override]);
}

export interface BuildCodexLaunchConfigInput {
  readonly provider: ProviderKind;
  readonly codexSettings: CodexSettings;
  readonly glmSettings?: GlmSettings;
  readonly glmBridgeBaseUrl?: string;
}

export function buildCodexLaunchConfig(input: BuildCodexLaunchConfigInput): CodexLaunchConfig {
  const { provider, codexSettings, glmSettings, glmBridgeBaseUrl } = input;

  const base: CodexLaunchConfig = {
    binaryPath: codexSettings.binaryPath || "codex",
    homePath: codexSettings.homePath || undefined,
    configOverrides: [],
    extraEnv: {},
  };

  if (provider !== "glm" || !glmSettings) {
    return base;
  }

  const baseUrl =
    glmSettings.transport === "bridge" && glmBridgeBaseUrl
      ? glmBridgeBaseUrl
      : glmSettings.upstreamBaseUrl;

  const configOverrides: string[] = [
    'model_provider="glm"',
    'model_providers.glm.name="GLM"',
    `model_providers.glm.base_url="${baseUrl}"`,
    'model_providers.glm.env_key="GLM_API_KEY"',
    'model_providers.glm.wire_api="responses"',
  ];

  return {
    ...base,
    configOverrides,
    extraEnv: {},
  };
}
