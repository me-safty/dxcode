import type { GlmSettings, ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { Effect, Equal, Layer, Stream } from "effect";

import {
  buildServerProvider,
  providerModelsFromSettings,
  type ProviderProbeResult,
} from "../providerSnapshot.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { GlmProvider } from "../Services/GlmProvider.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "glm" as const;

const DEFAULT_GLM_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "glm-5.1",
    name: "GLM 5.1",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
  {
    slug: "glm-5",
    name: "GLM 5",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
  {
    slug: "glm-5-turbo",
    name: "GLM 5 Turbo",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
  {
    slug: "glm-4.7",
    name: "GLM 4.7",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
  {
    slug: "glm-4.6",
    name: "GLM 4.6",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
  {
    slug: "glm-4.5",
    name: "GLM 4.5",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
  {
    slug: "glm-4.5-air",
    name: "GLM 4.5 Air",
    isCustom: false,
    capabilities: DEFAULT_GLM_MODEL_CAPABILITIES,
  },
];

function checkGlmProviderStatus(_glmSettings: GlmSettings): ProviderProbeResult {
  const hasApiKey = Boolean(process.env.GLM_API_KEY);

  if (!hasApiKey) {
    return {
      installed: true,
      version: null,
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Set the GLM_API_KEY environment variable to authenticate.",
    };
  }

  return {
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", type: "apiKey" },
  };
}

export const GlmProviderLive = Layer.effect(
  GlmProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;

    const checkProvider = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const glmSettings = settings.providers.glm;
      const probe = checkGlmProviderStatus(glmSettings);

      const models = providerModelsFromSettings(
        BUILT_IN_MODELS,
        PROVIDER,
        glmSettings.customModels,
        DEFAULT_GLM_MODEL_CAPABILITIES,
      );

      return buildServerProvider({
        provider: PROVIDER,
        enabled: glmSettings.enabled,
        checkedAt: new Date().toISOString(),
        models,
        probe,
      });
    });

    return yield* makeManagedServerProvider<GlmSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.glm),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.glm),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
