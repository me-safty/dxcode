import { describe, expect, it } from "vitest";

import {
  buildCodexLaunchConfig,
  buildCodexSpawnEnv,
  configOverridesToArgs,
  type BuildCodexLaunchConfigInput,
} from "./codexLaunchConfig.ts";

const defaultCodexSettings = {
  enabled: true,
  binaryPath: "/usr/local/bin/codex",
  homePath: "/home/user/.codex",
  customModels: [],
};

const defaultGlmSettings = {
  enabled: true,
  transport: "bridge" as const,
  upstreamBaseUrl: "https://api.z.ai/api/coding/paas/v4",
  customModels: [],
};

describe("buildCodexLaunchConfig", () => {
  it("returns base config with no overrides for codex provider", () => {
    const input: BuildCodexLaunchConfigInput = {
      provider: "codex",
      codexSettings: defaultCodexSettings,
    };

    const config = buildCodexLaunchConfig(input);

    expect(config.binaryPath).toBe("/usr/local/bin/codex");
    expect(config.homePath).toBe("/home/user/.codex");
    expect(config.configOverrides).toEqual([]);
    expect(config.extraEnv).toEqual({});
  });

  it("returns base config with no overrides for claudeAgent provider", () => {
    const config = buildCodexLaunchConfig({
      provider: "claudeAgent",
      codexSettings: defaultCodexSettings,
    });

    expect(config.configOverrides).toEqual([]);
  });

  it("falls back to 'codex' when binaryPath is empty", () => {
    const config = buildCodexLaunchConfig({
      provider: "codex",
      codexSettings: { ...defaultCodexSettings, binaryPath: "" },
    });

    expect(config.binaryPath).toBe("codex");
  });

  it("sets homePath to undefined when empty", () => {
    const config = buildCodexLaunchConfig({
      provider: "codex",
      codexSettings: { ...defaultCodexSettings, homePath: "" },
    });

    expect(config.homePath).toBeUndefined();
  });

  it("generates GLM provider overrides with bridge URL", () => {
    const config = buildCodexLaunchConfig({
      provider: "glm",
      codexSettings: defaultCodexSettings,
      glmSettings: defaultGlmSettings,
      glmBridgeBaseUrl: "http://127.0.0.1:9876/v1",
    });

    expect(config.configOverrides).toContain('model_provider="glm"');
    expect(config.configOverrides).toContain('model_providers.glm.name="GLM"');
    expect(config.configOverrides).toContain(
      'model_providers.glm.base_url="http://127.0.0.1:9876/v1"',
    );
    expect(config.configOverrides).toContain('model_providers.glm.env_key="GLM_API_KEY"');
    expect(config.configOverrides).toContain('model_providers.glm.wire_api="responses"');
  });

  it("uses upstream URL directly when transport is 'direct'", () => {
    const config = buildCodexLaunchConfig({
      provider: "glm",
      codexSettings: defaultCodexSettings,
      glmSettings: { ...defaultGlmSettings, transport: "direct" as const },
      glmBridgeBaseUrl: "http://127.0.0.1:9876/v1",
    });

    expect(config.configOverrides).toContain(
      'model_providers.glm.base_url="https://api.z.ai/api/coding/paas/v4"',
    );
  });

  it("falls back to upstream URL when bridge URL is not provided", () => {
    const config = buildCodexLaunchConfig({
      provider: "glm",
      codexSettings: defaultCodexSettings,
      glmSettings: defaultGlmSettings,
    });

    expect(config.configOverrides).toContain(
      'model_providers.glm.base_url="https://api.z.ai/api/coding/paas/v4"',
    );
  });

  it("returns base config when glm provider is selected but glmSettings is missing", () => {
    const config = buildCodexLaunchConfig({
      provider: "glm",
      codexSettings: defaultCodexSettings,
    });

    expect(config.configOverrides).toEqual([]);
  });
});

describe("buildCodexSpawnEnv", () => {
  it("merges process.env with CODEX_HOME when homePath is set", () => {
    const env = buildCodexSpawnEnv({
      binaryPath: "codex",
      homePath: "/custom/home",
      configOverrides: [],
      extraEnv: {},
    });

    expect(env.CODEX_HOME).toBe("/custom/home");
  });

  it("does not set CODEX_HOME when homePath is undefined", () => {
    const original = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;

    const env = buildCodexSpawnEnv({
      binaryPath: "codex",
      homePath: undefined,
      configOverrides: [],
      extraEnv: {},
    });

    expect(env.CODEX_HOME).toBeUndefined();

    if (original !== undefined) {
      process.env.CODEX_HOME = original;
    }
  });

  it("includes extraEnv entries", () => {
    const env = buildCodexSpawnEnv({
      binaryPath: "codex",
      homePath: undefined,
      configOverrides: [],
      extraEnv: { MY_VAR: "value" },
    });

    expect(env.MY_VAR).toBe("value");
  });
});

describe("configOverridesToArgs", () => {
  it("returns empty array for no overrides", () => {
    expect(configOverridesToArgs([])).toEqual([]);
  });

  it("flattens overrides into -c pairs", () => {
    const args = configOverridesToArgs(['model_provider="glm"', 'model_providers.glm.name="GLM"']);

    expect(args).toEqual(["-c", 'model_provider="glm"', "-c", 'model_providers.glm.name="GLM"']);
  });
});
