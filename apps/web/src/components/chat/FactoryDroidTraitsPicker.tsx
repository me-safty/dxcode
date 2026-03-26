import type {
  FactoryDroidEffort,
  FactoryDroidModelOptions,
  ProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import {
  EFFORT_LABELS,
  getDefaultReasoningEffort,
  getReasoningEffortOptions,
  normalizeFactoryDroidModelOptions,
  resolveReasoningEffortForProvider,
} from "@t3tools/shared/model";
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

const PROVIDER = "factoryDroid" as const satisfies ProviderKind;

function getSelectedDroidTraits(modelOptions: FactoryDroidModelOptions | null | undefined): {
  effort: FactoryDroidEffort;
} {
  const defaultEffort = getDefaultReasoningEffort(PROVIDER) as FactoryDroidEffort;
  return {
    effort:
      (resolveReasoningEffortForProvider(
        PROVIDER,
        modelOptions?.effort,
      ) as FactoryDroidEffort | null) ?? defaultEffort,
  };
}

function FactoryDroidTraitsMenuContentImpl(props: { threadId: ThreadId }) {
  const draft = useComposerThreadDraft(props.threadId);
  const modelOptions = draft.modelOptions?.[PROVIDER];
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const options = getReasoningEffortOptions(PROVIDER) as ReadonlyArray<FactoryDroidEffort>;
  const { effort } = getSelectedDroidTraits(modelOptions);

  return (
    <MenuGroup>
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Reasoning</div>
      <MenuRadioGroup
        value={effort}
        onValueChange={(value) => {
          if (!value) return;
          const nextEffort = options.find((option) => option === value);
          if (!nextEffort) return;
          setProviderModelOptions(
            props.threadId,
            PROVIDER,
            normalizeFactoryDroidModelOptions({ effort: nextEffort }),
            { persistSticky: true },
          );
        }}
      >
        {options.map((option) => (
          <MenuRadioItem key={option} value={option}>
            {EFFORT_LABELS[option] ?? option}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuGroup>
  );
}

export const FactoryDroidTraitsMenuContent = memo(FactoryDroidTraitsMenuContentImpl);

function FactoryDroidTraitsPickerImpl(props: { threadId: ThreadId }) {
  const draft = useComposerThreadDraft(props.threadId);
  const modelOptions = draft.modelOptions?.[PROVIDER];
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const options = getReasoningEffortOptions(PROVIDER) as ReadonlyArray<FactoryDroidEffort>;
  const defaultEffort = getDefaultReasoningEffort(PROVIDER) as FactoryDroidEffort;
  const { effort } = getSelectedDroidTraits(modelOptions);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const effortLabel = EFFORT_LABELS[effort] ?? effort;

  return (
    <Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0"
          />
        }
      >
        <span className="flex items-center gap-1">
          <span className="text-[11px]">{effortLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Reasoning</div>
          <MenuRadioGroup
            value={effort}
            onValueChange={(value) => {
              if (!value) return;
              const nextEffort = options.find((option) => option === value);
              if (!nextEffort) return;
              setProviderModelOptions(
                props.threadId,
                PROVIDER,
                normalizeFactoryDroidModelOptions({ effort: nextEffort }),
                { persistSticky: true },
              );
              setIsMenuOpen(false);
            }}
          >
            {options.map((option) => (
              <MenuRadioItem key={option} value={option}>
                {EFFORT_LABELS[option] ?? option}
                {option === defaultEffort ? (
                  <span className="ms-auto text-[10px] text-muted-foreground/80">default</span>
                ) : null}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export const FactoryDroidTraitsPicker = memo(FactoryDroidTraitsPickerImpl);
