import { Schema } from "effect";
import type { ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];
export const CLAUDE_CODE_EFFORT_OPTIONS = ["low", "medium", "high", "max", "ultrathink"] as const;
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_OPTIONS)[number];
export const FACTORY_DROID_EFFORT_OPTIONS = ["low", "medium", "high"] as const;
export type FactoryDroidEffort = (typeof FACTORY_DROID_EFFORT_OPTIONS)[number];
export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort | FactoryDroidEffort;

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(Schema.Literals(CLAUDE_CODE_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type ClaudeModelOptions = typeof ClaudeModelOptions.Type;

export const FactoryDroidModelOptions = Schema.Struct({
  effort: Schema.optional(Schema.Literals(FACTORY_DROID_EFFORT_OPTIONS)),
});
export type FactoryDroidModelOptions = typeof FactoryDroidModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeAgent: Schema.optional(ClaudeModelOptions),
  factoryDroid: Schema.optional(FactoryDroidModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

type ModelOption = {
  readonly slug: string;
  readonly name: string;
};

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  claudeAgent: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  factoryDroid: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-opus-4-6-fast", name: "Claude Opus 4.6 Fast" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { slug: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
    { slug: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
    { slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { slug: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { slug: "glm-4.7", name: "Droid Core (GLM-4.7)" },
    { slug: "glm-5", name: "Droid Core (GLM-5)" },
    { slug: "kimi-k2.5", name: "Droid Core (Kimi K2.5)" },
    { slug: "minimax-m2.5", name: "Droid Core (MiniMax M2.5)" },
    { slug: "custom:glm-5", name: "Custom: ZAI GLM-5" },
    { slug: "custom:claude-opus-4-6", name: "Custom: Claude Opus 4.6" },
    { slug: "custom:claude-sonnet-4-6", name: "Custom: Claude Sonnet 4.6" },
    { slug: "custom:gpt-5.3-codex-spark", name: "Custom: GPT-5.3 Codex Spark" },
    { slug: "custom:gpt-5.4", name: "Custom: GPT-5.4" },
    { slug: "custom:gpt-5.4-mini", name: "Custom: GPT-5.4 Mini" },
    { slug: "custom:glm-4.7", name: "Custom: GLM-4.7" },
    { slug: "custom:minimax-m2.5", name: "Custom: MiniMax-M2.5" },
    { slug: "custom:qwen3-coder-next", name: "Custom: Qwen3-Coder-Next" },
    { slug: "custom:qwen35-262b", name: "Custom: Qwen3.5-262B" },
    { slug: "custom:step-3.5-flash", name: "Custom: Step-3.5-Flash" },
    { slug: "custom:kimi-for-coding", name: "Custom: Kimi For Coding" },
    { slug: "custom:MiniMax-M2.7", name: "Custom: MiniMax-M2.7" },
    { slug: "custom:gemini-3-flash-preview", name: "Custom: Gemini 3 Flash" },
    { slug: "custom:gemini-3-pro-preview", name: "Custom: Gemini 3 Pro" },
    { slug: "custom:glm-5-turbo", name: "Custom: GLM-5-Turbo" },
    { slug: "custom:composer-2", name: "Custom: Composer 2" },
    { slug: "custom:composer-2-fast", name: "Custom: Composer 2 Fast" },
  ],
} as const satisfies Record<ProviderKind, readonly ModelOption[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = (typeof MODEL_OPTIONS_BY_PROVIDER)[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, ModelSlug> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  factoryDroid: "claude-opus-4-6",
};

// Backward compatibility for existing Codex-only call sites.
export const MODEL_OPTIONS = MODEL_OPTIONS_BY_PROVIDER.codex;
export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;
export const DEFAULT_GIT_TEXT_GENERATION_MODEL = "gpt-5.4-mini" as const;

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<ProviderKind, Record<string, ModelSlug>> = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeAgent: {
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  factoryDroid: {
    droid: "claude-opus-4-6",
    opus: "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "gemini-pro": "gemini-3.1-pro-preview",
    "gemini-flash": "gemini-3-flash-preview",
    glm: "glm-5",
    kimi: "kimi-k2.5",
    minimax: "minimax-m2.5",
  },
};

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  claudeAgent: CLAUDE_CODE_EFFORT_OPTIONS,
  factoryDroid: FACTORY_DROID_EFFORT_OPTIONS,
} as const satisfies Record<ProviderKind, readonly ProviderReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  claudeAgent: "high",
  factoryDroid: "high",
} as const satisfies Record<ProviderKind, ProviderReasoningEffort>;
