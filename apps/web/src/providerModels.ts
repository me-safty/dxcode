import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ModelCapabilities,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { normalizeModelSlug, resolveContextWindow, resolveEffort } from "@t3tools/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ReadonlyArray<ServerProviderModel> {
  return providers.find((candidate) => candidate.provider === provider)?.models ?? [];
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ServerProvider | undefined {
  return providers.find((candidate) => candidate.provider === provider);
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): boolean {
  return getProviderSnapshot(providers, provider)?.enabled ?? true;
}

export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind | null | undefined,
): ProviderKind {
  const requested = provider ?? "codex";
  if (isProviderEnabled(providers, requested)) {
    return requested;
  }
  return providers.find((candidate) => candidate.enabled)?.provider ?? requested;
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider);
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): string {
  const models = getProviderModels(providers, provider);
  return (
    models.find((model) => !model.isCustom)?.slug ??
    models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider]
  );
}

export function normalizeCodexModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: CodexModelOptions | null | undefined,
): CodexModelOptions | undefined {
  const reasoningEffort = resolveEffort(caps, modelOptions?.reasoningEffort);
  const fastMode = caps.supportsFastMode ? modelOptions?.fastMode : undefined;
  const nextOptions: CodexModelOptions = {
    ...(reasoningEffort
      ? { reasoningEffort: reasoningEffort as CodexModelOptions["reasoningEffort"] }
      : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeClaudeModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ClaudeModelOptions | null | undefined,
): ClaudeModelOptions | undefined {
  const effort = resolveEffort(caps, modelOptions?.effort);
  const thinking = caps.supportsThinkingToggle ? modelOptions?.thinking : undefined;
  const fastMode = caps.supportsFastMode ? modelOptions?.fastMode : undefined;
  const contextWindow = resolveContextWindow(caps, modelOptions?.contextWindow);
  const nextOptions: ClaudeModelOptions = {
    ...(thinking !== undefined ? { thinking } : {}),
    ...(effort ? { effort: effort as ClaudeModelOptions["effort"] } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
    ...(contextWindow ? { contextWindow } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}
