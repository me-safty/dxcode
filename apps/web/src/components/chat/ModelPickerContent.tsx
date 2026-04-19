import {
  type ProviderKind,
  PROVIDER_DISPLAY_NAMES,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { SearchIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { isModelPickerNewModel } from "./modelPickerModelHighlights";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";
import {
  PROVIDER_ICON_BY_PROVIDER,
  providerIconClassName,
  getProviderLabel,
} from "./providerIconUtils";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";

type ModelPickerItem = {
  slug: string;
  name: string;
  provider: ProviderKind;
};

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const { keybindings: providedKeybindings, modelOptionsByProvider, onProviderModelChange } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const favorites = useSettings((s) => s.favorites ?? []);
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind | "favorites">(() => {
    if (props.lockedProvider !== null) {
      return props.lockedProvider;
    }
    return favorites.length > 0 ? "favorites" : props.provider;
  });
  const keybindings = useMemo<ResolvedKeybindingsConfig>(
    () => providedKeybindings ?? [],
    [providedKeybindings],
  );
  const { updateSettings } = useUpdateSettings();

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectProvider = useCallback(
    (provider: ProviderKind | "favorites") => {
      setSelectedProvider(provider);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  useLayoutEffect(() => {
    focusSearchInput();
    const frame = window.requestAnimationFrame(() => {
      focusSearchInput();
    });
    const timeout = window.setTimeout(() => {
      focusSearchInput();
    }, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSearchInput]);

  // Create a Set for efficient lookup
  const favoritesSet = useMemo(() => {
    return new Set(favorites.map((fav) => `${fav.provider}:${fav.model}`));
  }, [favorites]);
  const favoriteOrder = useMemo(() => {
    return new Map(
      favorites.map((favorite, index) => [`${favorite.provider}:${favorite.model}`, index]),
    );
  }, [favorites]);

  const readyProviderSet = useMemo(() => {
    if (!props.providers || props.providers.length === 0) {
      return null;
    }
    return new Set(
      props.providers
        .filter((provider) => provider.status === "ready")
        .map((provider) => provider.provider),
    );
  }, [props.providers]);

  // Flatten models into a searchable array
  const flatModels = useMemo(() => {
    return Object.entries(props.modelOptionsByProvider).flatMap(([providerKind, models]) => {
      if (readyProviderSet && !readyProviderSet.has(providerKind as ProviderKind)) {
        return [];
      }
      return models.map((m) => ({
        slug: m.slug,
        name: m.name,
        provider: providerKind as ProviderKind,
      })) satisfies Array<ModelPickerItem>;
    });
  }, [props.modelOptionsByProvider, readyProviderSet]);

  // Filter models based on search query and selected provider
  const filteredModels = useMemo(() => {
    let result = flatModels;

    // Apply tokenized fuzzy search across the combined provider/model search fields.
    if (searchQuery.trim()) {
      const rankedMatches = result
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(model, searchQuery),
          isFavorite: favoritesSet.has(`${model.provider}:${model.slug}`),
          tieBreaker: buildModelPickerSearchText(model),
        }))
        .filter(
          (
            rankedModel,
          ): rankedModel is {
            model: ModelPickerItem;
            score: number;
            isFavorite: boolean;
            tieBreaker: string;
          } => rankedModel.score !== null,
        );

      // When searching, we only respect locked provider, ignoring sidebar selection
      if (props.lockedProvider !== null) {
        return rankedMatches
          .filter((rankedModel) => rankedModel.model.provider === props.lockedProvider)
          .toSorted((a, b) => {
            const scoreDelta = a.score - b.score;
            if (scoreDelta !== 0) {
              return scoreDelta;
            }
            if (a.isFavorite !== b.isFavorite) {
              return a.isFavorite ? -1 : 1;
            }
            return a.tieBreaker.localeCompare(b.tieBreaker);
          })
          .map((rankedModel) => rankedModel.model);
      }

      return rankedMatches
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          if (a.isFavorite !== b.isFavorite) {
            return a.isFavorite ? -1 : 1;
          }
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    // Locked provider mode always shows that provider's models, with favorites first.
    if (props.lockedProvider !== null) {
      result = result.filter((m) => m.provider === props.lockedProvider);
    } else if (selectedProvider === "favorites") {
      result = result.filter((m) => favoritesSet.has(`${m.provider}:${m.slug}`));
    } else {
      result = result.filter((m) => m.provider === selectedProvider);
    }

    return result.toSorted((a, b) => {
      const aOrder = favoriteOrder.get(`${a.provider}:${a.slug}`);
      const bOrder = favoriteOrder.get(`${b.provider}:${b.slug}`);

      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) {
        return -1;
      }
      if (bOrder !== undefined) {
        return 1;
      }
      return 0;
    });
  }, [
    favoriteOrder,
    favoritesSet,
    flatModels,
    props.lockedProvider,
    searchQuery,
    selectedProvider,
  ]);

  const handleModelSelect = useCallback(
    (modelSlug: string, provider: ProviderKind) => {
      const resolvedModel = resolveSelectableModel(
        provider,
        modelSlug,
        modelOptionsByProvider[provider],
      );
      if (resolvedModel) {
        onProviderModelChange(provider, resolvedModel);
      }
    },
    [modelOptionsByProvider, onProviderModelChange],
  );

  const toggleFavorite = useCallback(
    (provider: ProviderKind, model: string) => {
      const newFavorites = [...favorites];
      const index = newFavorites.findIndex((f) => f.provider === provider && f.model === model);
      if (index >= 0) {
        newFavorites.splice(index, 1);
      } else {
        newFavorites.push({ provider, model });
      }
      updateSettings({ favorites: newFavorites });
    },
    [favorites, updateSettings],
  );

  const isLocked = props.lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const showSidebar = !isLocked && !isSearching;
  const LockedProviderIcon =
    isLocked && props.lockedProvider ? PROVIDER_ICON_BY_PROVIDER[props.lockedProvider] : null;
  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<
      string,
      NonNullable<ReturnType<typeof modelPickerJumpCommandForIndex>>
    >();
    for (const [visibleModelIndex, model] of filteredModels.entries()) {
      const jumpCommand = modelPickerJumpCommandForIndex(visibleModelIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(`${model.provider}:${model.slug}`, jumpCommand);
    }
    return mapping;
  }, [filteredModels]);
  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  const modelJumpShortcutContext = useMemo(
    () =>
      ({
        terminalFocus: false,
        terminalOpen: props.terminalOpen,
        modelPickerOpen: true,
      }) as const,
    [props.terminalOpen],
  );
  const modelJumpLabelByKey = useMemo((): ReadonlyMap<string, string> => {
    if (modelJumpCommandByKey.size === 0) {
      return EMPTY_MODEL_JUMP_LABELS;
    }
    const shortcutLabelOptions = {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    };
    const mapping = new Map<string, string>();
    for (const [modelKey, command] of modelJumpCommandByKey) {
      const label = shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
      if (label) {
        mapping.set(modelKey, label);
      }
    }
    return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
  }, [keybindings, modelJumpCommandByKey, modelJumpShortcutContext]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: modelJumpShortcutContext,
      });
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetModelKey = modelJumpModelKeys[jumpIndex];
      if (!targetModelKey) {
        return;
      }
      const [provider, slug] = targetModelKey.split(":") as [ProviderKind, string];
      event.preventDefault();
      event.stopPropagation();
      handleModelSelect(slug, provider);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [handleModelSelect, keybindings, modelJumpModelKeys, modelJumpShortcutContext]);

  return (
    <div
      className={cn(
        "flex h-screen max-h-96 w-screen max-w-100 bg-popover",
        isLocked ? "flex-col" : "flex-row",
      )}
    >
      {/* Locked provider header (only shown in locked mode) */}
      {isLocked && LockedProviderIcon && props.lockedProvider && (
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <LockedProviderIcon
            className={cn(
              "size-5 shrink-0",
              providerIconClassName(props.lockedProvider, "text-muted-foreground/85"),
            )}
          />
          <span className="font-medium text-sm">
            {props.lockedProvider === "opencode"
              ? PROVIDER_DISPLAY_NAMES.opencode
              : getProviderLabel(props.lockedProvider, "")}
          </span>
        </div>
      )}

      {/* Sidebar (only in unlocked mode) */}
      {showSidebar && (
        <ModelPickerSidebar
          selectedProvider={selectedProvider}
          onSelectProvider={handleSelectProvider}
          {...(props.providers && { providers: props.providers })}
        />
      )}

      {/* Main content area */}
      <div className={cn("flex-1 flex flex-col", isLocked ? "min-w-0" : showSidebar && "border-l")}>
        {/* Search bar */}
        <div className="px-3 py-2 border-b flex items-center gap-2 relative z-20">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground/50" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                props.onRequestClose?.();
                return;
              }
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            autoFocus
            className="flex-1 bg-transparent text-xs font-normal leading-snug outline-none placeholder:text-muted-foreground/50 relative z-20"
          />
        </div>

        {/* Model list */}
        <div className="flex-1 overflow-y-auto model-picker-list">
          {filteredModels.length > 0 ? (
            <div className="divide-y p-1">
              {filteredModels.map((model) => (
                <ModelListRow
                  key={`${model.provider}:${model.slug}`}
                  slug={model.slug}
                  name={model.name}
                  provider={model.provider}
                  isSelected={props.provider === model.provider && props.model === model.slug}
                  isFavorite={favoritesSet.has(`${model.provider}:${model.slug}`)}
                  showProvider={!isLocked}
                  showNewBadge={isModelPickerNewModel(model.provider, model.slug)}
                  jumpLabel={modelJumpLabelByKey.get(`${model.provider}:${model.slug}`) ?? null}
                  onSelect={() => handleModelSelect(model.slug, model.provider)}
                  onToggleFavorite={() => toggleFavorite(model.provider, model.slug)}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs font-normal leading-snug text-muted-foreground">
              No models found
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
