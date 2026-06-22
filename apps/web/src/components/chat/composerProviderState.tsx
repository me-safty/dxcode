import {
  type ModelCapabilities,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@t3tools/shared/model";
import type { ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { shouldRenderTraitsControls, TraitsMenuContent, TraitsPicker } from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  prompt: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
};

/**
 * Cursor ACP can report `fastMode: true` as the provider default. T3 should only
 * use Fast when the user explicitly selected it (draft/sticky/settings); otherwise
 * default to Normal so new chats do not inherit the provider default.
 */
export function withImplicitFastModeDefault(
  caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const hasExplicitFastMode = modelOptions?.some((selection) => selection.id === "fastMode");
  if (hasExplicitFastMode) {
    return modelOptions ?? undefined;
  }
  const hasFastModeDescriptor = caps.optionDescriptors?.some(
    (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  if (!hasFastModeDescriptor) {
    return modelOptions ?? undefined;
  }
  return [...(modelOptions ?? []), { id: "fastMode", value: false }];
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, prompt, modelOptions } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const selections = withImplicitFastModeDefault(caps, modelOptions);
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(prompt);

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildProviderOptionSelectionsFromDescriptors(descriptors),
    ...(ultrathinkActive
      ? {
          composerFrameClassName: "ultrathink-frame",
          composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
          modelPickerIconClassName: "ultrathink-chroma",
        }
      : {}),
  };
}

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    prompt,
    onPromptChange,
  } = input;
  const hasTarget = threadRef !== undefined || draftId !== undefined;
  const caps = getProviderModelCapabilities(models, model, provider);
  const resolvedModelOptions = withImplicitFastModeDefault(caps, modelOptions);
  if (
    !hasTarget ||
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      modelOptions: resolvedModelOptions,
      prompt,
    })
  ) {
    return null;
  }
  return (
    <Component
      provider={provider}
      {...(instanceId ? { instanceId } : {})}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={resolvedModelOptions}
      prompt={prompt}
      onPromptChange={onPromptChange}
    />
  );
}

export function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

export function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}
