import {
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ProviderKind,
  type ProviderModelOptions,
  type ThreadId,
} from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  EFFORT_LABELS,
  getDefaultReasoningEffort,
  getReasoningEffortOptions,
  isClaudeUltrathinkPrompt,
  resolveReasoningEffortForProvider,
  supportsClaudeAdaptiveReasoning,
  supportsClaudeFastMode,
  supportsClaudeThinkingToggle,
  trimOrNull,
} from "@t3tools/shared/model";
import { memo, useCallback, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore } from "../../composerDraftStore";

type ProviderOptions = ProviderModelOptions[ProviderKind];

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

function getRawEffort(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
): string | null {
  if (provider === "codex") {
    return trimOrNull((modelOptions as CodexModelOptions | undefined)?.reasoningEffort);
  }
  return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.effort);
}

function buildNextOptions(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
  patch: Record<string, unknown>,
): ProviderOptions {
  if (provider === "codex") {
    return { ...(modelOptions as CodexModelOptions | undefined), ...patch } as CodexModelOptions;
  }
  return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions;
}

function getSelectedTraits(
  provider: ProviderKind,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
) {
  const effortOptions = getReasoningEffortOptions(provider, model);
  const defaultEffort = effortOptions.length > 0 ? getDefaultReasoningEffort(provider) : null;
  const isUltrathinkSupported =
    provider === "claudeAgent" && supportsClaudeAdaptiveReasoning(model);
  const promptInjectedEfforts = isUltrathinkSupported ? ["ultrathink"] : [];

  const resolvedEffort = getRawEffort(provider, modelOptions);
  const isPromptInjected = resolvedEffort ? promptInjectedEfforts.includes(resolvedEffort) : false;
  const effort =
    resolvedEffort &&
    !isPromptInjected &&
    (effortOptions as ReadonlyArray<string>).includes(resolvedEffort)
      ? resolvedEffort
      : defaultEffort && (effortOptions as ReadonlyArray<string>).includes(defaultEffort)
        ? defaultEffort
        : null;

  const supportsThinking = provider === "claudeAgent" && supportsClaudeThinkingToggle(model);
  const thinkingEnabled = supportsThinking
    ? ((modelOptions as ClaudeModelOptions | undefined)?.thinking ?? true)
    : null;

  const supportsFastMode =
    provider === "codex" || (provider === "claudeAgent" && supportsClaudeFastMode(model));
  const fastModeEnabled =
    supportsFastMode && (modelOptions as { fastMode?: boolean } | undefined)?.fastMode === true;

  const ultrathinkPromptControlled =
    promptInjectedEfforts.length > 0 && isClaudeUltrathinkPrompt(prompt);

  return {
    effort,
    effortOptions,
    defaultEffort,
    promptInjectedEfforts,
    thinkingEnabled,
    supportsFastMode,
    fastModeEnabled,
    ultrathinkPromptControlled,
  };
}

export interface TraitsMenuContentProps {
  provider: ProviderKind;
  threadId: ThreadId;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  threadId,
  model,
  prompt,
  onPromptChange,
  modelOptions,
}: TraitsMenuContentProps) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const {
    effort,
    effortOptions,
    defaultEffort,
    promptInjectedEfforts,
    thinkingEnabled,
    supportsFastMode,
    fastModeEnabled,
    ultrathinkPromptControlled,
  } = getSelectedTraits(provider, model, prompt, modelOptions);

  const handleEffortChange = useCallback(
    (value: string) => {
      if (ultrathinkPromptControlled) return;
      if (!value) return;
      if (!(effortOptions as ReadonlyArray<string>).includes(value)) return;
      if (promptInjectedEfforts.includes(value)) {
        const nextPrompt =
          prompt.trim().length === 0
            ? ULTRATHINK_PROMPT_PREFIX
            : applyClaudePromptEffortPrefix(prompt, "ultrathink");
        onPromptChange(nextPrompt);
        return;
      }
      const effortKey = provider === "codex" ? "reasoningEffort" : "effort";
      setProviderModelOptions(
        threadId,
        provider,
        buildNextOptions(provider, modelOptions, { [effortKey]: value }),
        { persistSticky: true },
      );
    },
    [
      ultrathinkPromptControlled,
      modelOptions,
      onPromptChange,
      threadId,
      setProviderModelOptions,
      effortOptions,
      prompt,
      promptInjectedEfforts,
      provider,
    ],
  );

  if (effort === null && thinkingEnabled === null) {
    return null;
  }

  return (
    <>
      {effort ? (
        <>
          <MenuGroup>
            <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Effort</div>
            {ultrathinkPromptControlled ? (
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                Remove Ultrathink from the prompt to change effort.
              </div>
            ) : null}
            <MenuRadioGroup value={effort} onValueChange={handleEffortChange}>
              {effortOptions.map((value) => (
                <MenuRadioItem key={value} value={value} disabled={ultrathinkPromptControlled}>
                  {EFFORT_LABELS[value] ?? value}
                  {value === defaultEffort ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : thinkingEnabled !== null ? (
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Thinking</div>
          <MenuRadioGroup
            value={thinkingEnabled ? "on" : "off"}
            onValueChange={(value) => {
              setProviderModelOptions(
                threadId,
                provider,
                buildNextOptions(provider, modelOptions, { thinking: value === "on" }),
                { persistSticky: true },
              );
            }}
          >
            <MenuRadioItem value="on">On (default)</MenuRadioItem>
            <MenuRadioItem value="off">Off</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      ) : null}
      {supportsFastMode ? (
        <>
          <MenuDivider />
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Fast Mode</div>
            <MenuRadioGroup
              value={fastModeEnabled ? "on" : "off"}
              onValueChange={(value) => {
                setProviderModelOptions(
                  threadId,
                  provider,
                  buildNextOptions(provider, modelOptions, { fastMode: value === "on" }),
                  { persistSticky: true },
                );
              }}
            >
              <MenuRadioItem value="off">off</MenuRadioItem>
              <MenuRadioItem value="on">on</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : null}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  threadId,
  model,
  prompt,
  onPromptChange,
  modelOptions,
}: TraitsMenuContentProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const {
    effort,
    effortOptions,
    thinkingEnabled,
    supportsFastMode,
    fastModeEnabled,
    ultrathinkPromptControlled,
  } = getSelectedTraits(provider, model, prompt, modelOptions);

  const effortLabel = effort ? (EFFORT_LABELS[effort] ?? effort) : null;
  const triggerLabel = [
    ultrathinkPromptControlled
      ? "Ultrathink"
      : effortLabel
        ? effortLabel
        : thinkingEnabled === null
          ? null
          : `Thinking ${thinkingEnabled ? "On" : "Off"}`,
    ...(supportsFastMode && fastModeEnabled ? ["Fast"] : []),
  ]
    .filter(Boolean)
    .join(" · ");

  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={
              isCodexStyle
                ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0"
                : "shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
            }
          />
        }
      >
        {isCodexStyle ? (
          <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
            {triggerLabel}
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </span>
        ) : (
          <>
            <span>{triggerLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <TraitsMenuContent
          provider={provider}
          threadId={threadId}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
        />
      </MenuPopup>
    </Menu>
  );
});
