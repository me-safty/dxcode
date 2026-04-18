import { type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { memo, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon, BotIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ClaudeAI, CursorIcon, type Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { describeProviderAvailability, formatProviderDisplayLabel } from "../../coworkShell";
import { cn } from "~/lib/utils";
const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderKind, Icon>> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  opencode: OpenCodeIcon,
  cursor: CursorIcon,
};

function providerIconClassName(provider: ProviderKind, fallbackClassName: string): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

function providerIconFor(provider: ProviderKind): Icon | typeof BotIcon {
  return PROVIDER_ICON_BY_PROVIDER[provider] ?? BotIcon;
}

type ProviderModelOptionsByProvider =
  | ReadonlyMap<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  | Partial<Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>>;

function getProviderModelOptions(
  modelOptionsByProvider: ProviderModelOptionsByProvider,
  provider: ProviderKind,
): ReadonlyArray<{ slug: string; name: string }> {
  if (modelOptionsByProvider instanceof Map) {
    return modelOptionsByProvider.get(provider) ?? [];
  }

  const recordOptions = modelOptionsByProvider as Partial<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
  return recordOptions[provider] ?? [];
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: ProviderModelOptionsByProvider;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeProvider = props.lockedProvider ?? props.provider;
  const selectedProviderOptions = getProviderModelOptions(
    props.modelOptionsByProvider,
    activeProvider,
  );
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ??
    formatProviderDisplayLabel(activeProvider);
  const ProviderIcon = providerIconFor(activeProvider);
  const providerMenuOptions = useMemo(() => {
    if (props.providers && props.providers.length > 0) {
      return props.providers.map((provider) => ({
        provider: provider.provider,
        enabled: provider.enabled,
        installed: provider.installed,
        status: provider.status,
      }));
    }

    return [
      {
        provider: activeProvider,
        enabled: true,
        installed: true,
        status: "ready" as const,
      },
    ];
  }, [activeProvider, props.providers]);
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      getProviderModelOptions(props.modelOptionsByProvider, provider),
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsMenuOpen(false);
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36 sm:pl-1" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              providerIconClassName(activeProvider, "text-muted-foreground/70"),
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {props.lockedProvider !== null ? (
          <MenuGroup>
            <MenuRadioGroup
              value={props.model}
              onValueChange={(value) => handleModelChange(props.lockedProvider!, value)}
            >
              {getProviderModelOptions(props.modelOptionsByProvider, props.lockedProvider).map(
                (modelOption) => (
                  <MenuRadioItem
                    key={`${props.lockedProvider}:${modelOption.slug}`}
                    value={modelOption.slug}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {modelOption.name}
                  </MenuRadioItem>
                ),
              )}
            </MenuRadioGroup>
          </MenuGroup>
        ) : (
          <>
            {providerMenuOptions.map((option) => {
              const OptionIcon = providerIconFor(option.provider);
              const providerLabel = formatProviderDisplayLabel(option.provider);
              const providerModels = getProviderModelOptions(
                props.modelOptionsByProvider,
                option.provider,
              );
              if (
                option.status !== "ready" ||
                !option.enabled ||
                !option.installed ||
                providerModels.length === 0
              ) {
                return (
                  <MenuItem key={option.provider} disabled>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 opacity-80",
                        providerIconClassName(option.provider, "text-muted-foreground/85"),
                      )}
                    />
                    <span>{providerLabel}</span>
                    <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                      {providerModels.length === 0
                        ? "No models"
                        : describeProviderAvailability(option)}
                    </span>
                  </MenuItem>
                );
              }
              return (
                <MenuSub key={option.provider}>
                  <MenuSubTrigger>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        providerIconClassName(option.provider, "text-muted-foreground/85"),
                      )}
                    />
                    {providerLabel}
                  </MenuSubTrigger>
                  <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
                    <MenuGroup>
                      <MenuRadioGroup
                        value={props.provider === option.provider ? props.model : ""}
                        onValueChange={(value) => handleModelChange(option.provider, value)}
                      >
                        {providerModels.map((modelOption) => (
                          <MenuRadioItem
                            key={`${option.provider}:${modelOption.slug}`}
                            value={modelOption.slug}
                            onClick={() => setIsMenuOpen(false)}
                          >
                            {modelOption.name}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
            {providerMenuOptions.length === 0 ? (
              <>
                <MenuDivider />
                <MenuItem disabled>No providers available</MenuItem>
              </>
            ) : null}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
});
