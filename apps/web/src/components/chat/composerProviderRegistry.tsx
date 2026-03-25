import {
  type ModelSlug,
  type ProviderKind,
  type ProviderModelOptions,
  type ThreadId,
} from "@t3tools/contracts";
import {
  getDefaultReasoningEffort,
  getReasoningEffortOptions,
  isClaudeUltrathinkPrompt,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeFactoryDroidModelOptions,
  resolveReasoningEffortForProvider,
  supportsClaudeUltrathinkKeyword,
} from "@t3tools/shared/model";
import type { ReactNode } from "react";
import { TraitsMenuContent, TraitsPicker } from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderKind;
  model: ModelSlug;
  prompt: string;
  modelOptions: ProviderModelOptions | null | undefined;
};

export type ComposerProviderState = {
  provider: ProviderKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ProviderModelOptions | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type RenderInput = {
  threadId: ThreadId;
  model: ModelSlug;
  prompt: string;
  modelOptions: ProviderModelOptions[ProviderKind] | null | undefined;
  onPromptChange: (prompt: string) => void;
};

type ProviderRegistryEntry = {
  getState: (input: ComposerProviderStateInput) => ComposerProviderState;
  renderTraitsMenuContent: (input: RenderInput) => ReactNode;
  renderTraitsPicker: (input: RenderInput) => ReactNode;
};

const composerProviderRegistry: Record<ProviderKind, ProviderRegistryEntry> = {
  codex: {
    getState: ({ model, modelOptions }) => {
      const promptEffort =
        resolveReasoningEffortForProvider("codex", modelOptions?.codex?.reasoningEffort) ??
        getDefaultReasoningEffort("codex");
      const normalizedCodexOptions = normalizeCodexModelOptions(model, modelOptions?.codex);

      return {
        provider: "codex",
        promptEffort,
        modelOptionsForDispatch: normalizedCodexOptions
          ? { codex: normalizedCodexOptions }
          : undefined,
      };
    },
    renderTraitsMenuContent: ({ threadId, model, prompt, modelOptions, onPromptChange }) => (
      <TraitsMenuContent
        provider="codex"
        threadId={threadId}
        model={model}
        prompt={prompt}
        modelOptions={modelOptions}
        onPromptChange={onPromptChange}
      />
    ),
    renderTraitsPicker: ({ threadId, model, prompt, modelOptions, onPromptChange }) => (
      <TraitsPicker
        provider="codex"
        threadId={threadId}
        model={model}
        prompt={prompt}
        modelOptions={modelOptions}
        onPromptChange={onPromptChange}
      />
    ),
  },
  claudeAgent: {
    getState: ({ model, prompt, modelOptions }) => {
      const reasoningOptions = getReasoningEffortOptions("claudeAgent", model);
      const draftEffort = resolveReasoningEffortForProvider(
        "claudeAgent",
        modelOptions?.claudeAgent?.effort,
      );
      const defaultEffort = getDefaultReasoningEffort("claudeAgent");
      const promptEffort =
        draftEffort && draftEffort !== "ultrathink" && reasoningOptions.includes(draftEffort)
          ? draftEffort
          : reasoningOptions.includes(defaultEffort)
            ? defaultEffort
            : null;
      const normalizedClaudeOptions = normalizeClaudeModelOptions(model, modelOptions?.claudeAgent);
      const ultrathinkActive =
        supportsClaudeUltrathinkKeyword(model) && isClaudeUltrathinkPrompt(prompt);

      return {
        provider: "claudeAgent",
        promptEffort,
        modelOptionsForDispatch: normalizedClaudeOptions
          ? { claudeAgent: normalizedClaudeOptions }
          : undefined,
        ...(ultrathinkActive ? { composerFrameClassName: "ultrathink-frame" } : {}),
        ...(ultrathinkActive
          ? { composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]" }
          : {}),
        ...(ultrathinkActive ? { modelPickerIconClassName: "ultrathink-chroma" } : {}),
      };
    },
    renderTraitsMenuContent: ({ threadId, model, prompt, modelOptions, onPromptChange }) => (
      <TraitsMenuContent
        provider="claudeAgent"
        threadId={threadId}
        model={model}
        prompt={prompt}
        modelOptions={modelOptions}
        onPromptChange={onPromptChange}
      />
    ),
    renderTraitsPicker: ({ threadId, model, prompt, modelOptions, onPromptChange }) => (
      <TraitsPicker
        provider="claudeAgent"
        threadId={threadId}
        model={model}
        prompt={prompt}
        modelOptions={modelOptions}
        onPromptChange={onPromptChange}
      />
    ),
  },
  factoryDroid: {
    getState: ({ modelOptions }) => {
      const promptEffort =
        resolveReasoningEffortForProvider("factoryDroid", modelOptions?.factoryDroid?.effort) ??
        getDefaultReasoningEffort("factoryDroid");
      const normalizedDroidOptions = normalizeFactoryDroidModelOptions(modelOptions?.factoryDroid);

      return {
        provider: "factoryDroid",
        promptEffort,
        modelOptionsForDispatch: normalizedDroidOptions
          ? { factoryDroid: normalizedDroidOptions }
          : undefined,
      };
    },
    renderTraitsMenuContent: ({ threadId, model, prompt, modelOptions, onPromptChange }) => (
      <TraitsMenuContent
        provider="factoryDroid"
        threadId={threadId}
        model={model}
        prompt={prompt}
        modelOptions={modelOptions}
        onPromptChange={onPromptChange}
      />
    ),
    renderTraitsPicker: ({ threadId, model, prompt, modelOptions, onPromptChange }) => (
      <TraitsPicker
        provider="factoryDroid"
        threadId={threadId}
        model={model}
        prompt={prompt}
        modelOptions={modelOptions}
        onPromptChange={onPromptChange}
      />
    ),
  },
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  return composerProviderRegistry[input.provider].getState(input);
}

export function renderProviderTraitsMenuContent(input: {
  provider: ProviderKind;
  threadId: ThreadId;
  model: ModelSlug;
  prompt: string;
  modelOptions: ProviderModelOptions[ProviderKind] | null | undefined;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  return composerProviderRegistry[input.provider].renderTraitsMenuContent({
    threadId: input.threadId,
    model: input.model,
    prompt: input.prompt,
    modelOptions: input.modelOptions,
    onPromptChange: input.onPromptChange,
  });
}

export function renderProviderTraitsPicker(input: {
  provider: ProviderKind;
  threadId: ThreadId;
  model: ModelSlug;
  prompt: string;
  modelOptions: ProviderModelOptions[ProviderKind] | null | undefined;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  return composerProviderRegistry[input.provider].renderTraitsPicker({
    threadId: input.threadId,
    model: input.model,
    prompt: input.prompt,
    modelOptions: input.modelOptions,
    onPromptChange: input.onPromptChange,
  });
}
