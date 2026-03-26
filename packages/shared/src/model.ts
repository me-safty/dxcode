import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  REASONING_EFFORT_OPTIONS_BY_PROVIDER,
  type ClaudeModelOptions,
  type ClaudeCodeEffort,
  type CodexModelOptions,
  type CodexReasoningEffort,
  type FactoryDroidModelOptions,
  type FactoryDroidEffort,
  type ModelSlug,
  type ProviderReasoningEffort,
  type ProviderKind,
} from "@t3tools/contracts";

// ── Precomputed slug sets ─────────────────────────────────────────────

const MODEL_SLUG_SET_BY_PROVIDER: Record<ProviderKind, ReadonlySet<ModelSlug>> = {
  claudeAgent: new Set(MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((option) => option.slug)),
  codex: new Set(MODEL_OPTIONS_BY_PROVIDER.codex.map((option) => option.slug)),
  factoryDroid: new Set(MODEL_OPTIONS_BY_PROVIDER.factoryDroid.map((option) => option.slug)),
};

// ── Provider capabilities ─────────────────────────────────────────────

export interface ProviderCapabilities {
  readonly requiresStreamingDelivery: boolean;
}

const PROVIDER_CAPABILITIES: Record<ProviderKind, ProviderCapabilities> = {
  codex: { requiresStreamingDelivery: false },
  claudeAgent: { requiresStreamingDelivery: false },
  factoryDroid: { requiresStreamingDelivery: true },
};

export function getProviderCapabilities(provider: ProviderKind): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

// ── Selectable model helpers ──────────────────────────────────────────

export interface SelectableModelOption {
  slug: string;
  name: string;
}

export function getModelOptions(provider: ProviderKind = "codex") {
  return MODEL_OPTIONS_BY_PROVIDER[provider];
}

export function getDefaultModel(provider: ProviderKind = "codex"): ModelSlug {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

// ── Reasoning effort (typed, provider-aware) ──────────────────────────

export function getReasoningEffortOptions(provider: "codex"): ReadonlyArray<CodexReasoningEffort>;
export function getReasoningEffortOptions(
  provider: "claudeAgent",
  model?: string | null | undefined,
): ReadonlyArray<ClaudeCodeEffort>;
export function getReasoningEffortOptions(
  provider?: ProviderKind,
  model?: string | null | undefined,
): ReadonlyArray<ProviderReasoningEffort>;
export function getReasoningEffortOptions(
  provider: ProviderKind = "codex",
  model?: string | null | undefined,
): ReadonlyArray<ProviderReasoningEffort> {
  if (provider === "claudeAgent") {
    if (supportsClaudeMaxEffort(model)) {
      return ["low", "medium", "high", "max", "ultrathink"];
    }
    if (supportsClaudeAdaptiveReasoning(model)) {
      return ["low", "medium", "high", "ultrathink"];
    }
    return [];
  }
  return REASONING_EFFORT_OPTIONS_BY_PROVIDER[provider];
}

export function getDefaultReasoningEffort(provider: "codex"): CodexReasoningEffort;
export function getDefaultReasoningEffort(provider: "claudeAgent"): ClaudeCodeEffort;
export function getDefaultReasoningEffort(provider?: ProviderKind): ProviderReasoningEffort;
export function getDefaultReasoningEffort(
  provider: ProviderKind = "codex",
): ProviderReasoningEffort {
  return DEFAULT_REASONING_EFFORT_BY_PROVIDER[provider];
}

export function resolveReasoningEffortForProvider(
  provider: "codex",
  effort: string | null | undefined,
): CodexReasoningEffort | null;
export function resolveReasoningEffortForProvider(
  provider: "claudeAgent",
  effort: string | null | undefined,
): ClaudeCodeEffort | null;
export function resolveReasoningEffortForProvider(
  provider: ProviderKind,
  effort: string | null | undefined,
): ProviderReasoningEffort | null;
export function resolveReasoningEffortForProvider(
  provider: ProviderKind,
  effort: string | null | undefined,
): ProviderReasoningEffort | null {
  if (typeof effort !== "string") return null;
  const trimmed = effort.trim();
  if (!trimmed) return null;
  const options = REASONING_EFFORT_OPTIONS_BY_PROVIDER[provider] as ReadonlyArray<string>;
  return options.includes(trimmed) ? (trimmed as ProviderReasoningEffort) : null;
}

// ── Effort labels ─────────────────────────────────────────────────────

export const EFFORT_LABELS: Record<string, string> = {
  xhigh: "Extra High",
  high: "High",
  medium: "Medium",
  low: "Low",
  max: "Max",
  ultrathink: "Ultrathink",
};

// ── Claude model-specific checks ──────────────────────────────────────

export function supportsClaudeFastMode(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeAgent") === "claude-opus-4-6";
}

export function supportsClaudeAdaptiveReasoning(model: string | null | undefined): boolean {
  const normalized = normalizeModelSlug(model, "claudeAgent");
  return normalized === "claude-opus-4-6" || normalized === "claude-sonnet-4-6";
}

export const supportsClaudeMaxEffort = supportsClaudeFastMode;

export const supportsClaudeUltrathinkKeyword = supportsClaudeAdaptiveReasoning;

export function supportsClaudeThinkingToggle(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeAgent") === "claude-haiku-4-5";
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

// ── Model slug resolution ─────────────────────────────────────────────

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  if (typeof model !== "string") return null;
  const trimmed = model.trim();
  if (!trimmed) return null;

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, ModelSlug>;
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : (trimmed as ModelSlug);
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): ModelSlug | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) return direct.slug;

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName.slug;

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) return null;

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

export function resolveModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) return DEFAULT_MODEL_BY_PROVIDER[provider];

  // Factory Droid accepts any model ID -- the CLI validates it server-side.
  if (provider === "factoryDroid") return normalized;

  return MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)
    ? normalized
    : DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelSlug {
  return resolveModelSlug(model, provider);
}

export function inferProviderForModel(
  model: string | null | undefined,
  fallback: ProviderKind = "codex",
): ProviderKind {
  const normalizedFallback = normalizeModelSlug(model, fallback);
  if (normalizedFallback && MODEL_SLUG_SET_BY_PROVIDER[fallback].has(normalizedFallback)) {
    return fallback;
  }

  const otherProviders = (["codex", "claudeAgent", "factoryDroid"] as const).filter(
    (p) => p !== fallback,
  );
  for (const provider of otherProviders) {
    const normalized = normalizeModelSlug(model, provider);
    if (normalized && MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)) {
      return provider;
    }
  }

  if (typeof model === "string") {
    const trimmed = model.trim();
    if (trimmed.startsWith("claude-")) return "claudeAgent";
    if (trimmed.startsWith("droid-") || trimmed.startsWith("custom:")) return "factoryDroid";
  }

  return fallback;
}

// ── String utility ────────────────────────────────────────────────────

export function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Model options normalization ───────────────────────────────────────

export function normalizeCodexModelOptions(
  model: string | null | undefined,
  modelOptions: CodexModelOptions | null | undefined,
): CodexModelOptions | undefined {
  const defaultReasoningEffort = getDefaultReasoningEffort("codex");
  const reasoningEffort =
    resolveReasoningEffortForProvider("codex", modelOptions?.reasoningEffort) ??
    defaultReasoningEffort;
  const fastModeEnabled = modelOptions?.fastMode === true;
  const nextOptions: CodexModelOptions = {
    ...(reasoningEffort !== defaultReasoningEffort ? { reasoningEffort } : {}),
    ...(fastModeEnabled ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeClaudeModelOptions(
  model: string | null | undefined,
  modelOptions: ClaudeModelOptions | null | undefined,
): ClaudeModelOptions | undefined {
  const reasoningOptions = getReasoningEffortOptions("claudeAgent", model);
  const defaultReasoningEffort = getDefaultReasoningEffort("claudeAgent");
  const resolvedEffort = resolveReasoningEffortForProvider("claudeAgent", modelOptions?.effort);
  const effort =
    resolvedEffort &&
    resolvedEffort !== "ultrathink" &&
    reasoningOptions.includes(resolvedEffort) &&
    resolvedEffort !== defaultReasoningEffort
      ? resolvedEffort
      : undefined;
  const thinking =
    supportsClaudeThinkingToggle(model) && modelOptions?.thinking === false ? false : undefined;
  const fastMode =
    supportsClaudeFastMode(model) && modelOptions?.fastMode === true ? true : undefined;
  const nextOptions: ClaudeModelOptions = {
    ...(thinking === false ? { thinking: false } : {}),
    ...(effort ? { effort } : {}),
    ...(fastMode ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeFactoryDroidModelOptions(
  modelOptions: FactoryDroidModelOptions | null | undefined,
): FactoryDroidModelOptions | undefined {
  const defaultEffort = getDefaultReasoningEffort("factoryDroid");
  const effort = resolveReasoningEffortForProvider("factoryDroid", modelOptions?.effort);
  if (effort && effort !== defaultEffort) {
    return { effort: effort as FactoryDroidEffort };
  }
  return undefined;
}

// ── Prompt effort injection ───────────────────────────────────────────

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (effort !== "ultrathink") return trimmed;
  if (trimmed.startsWith("Ultrathink:")) return trimmed;
  return `Ultrathink:\n${trimmed}`;
}
