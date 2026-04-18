import { type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { memo } from "react";
import { StarIcon } from "lucide-react";
import { Gemini } from "../Icons";
import { PROVIDER_ICON_BY_PROVIDER, providerIconClassName } from "./providerIconUtils";
import { AVAILABLE_PROVIDER_OPTIONS } from "./ProviderModelPicker";
import { cn } from "~/lib/utils";
import { getProviderSnapshot } from "../../providerModels";

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedProvider: ProviderKind | "all" | "favorites";
  onSelectProvider: (provider: ProviderKind | "all" | "favorites") => void;
  providers?: ReadonlyArray<ServerProvider>;
}) {
  const handleProviderClick = (provider: ProviderKind | "all" | "favorites") => {
    props.onSelectProvider(provider);
  };

  return (
    <div className="flex flex-col w-16 border-r bg-muted/30 py-2 px-1 overflow-y-auto">
      {/* All button */}
      <button
        className={cn(
          "flex items-center justify-center p-2 rounded transition-colors hover:bg-muted",
          props.selectedProvider === "all" && "bg-accent text-accent-foreground",
        )}
        onClick={() => handleProviderClick("all")}
        title="All models"
        type="button"
        aria-label="All models"
      >
        <div className="text-lg" aria-hidden>
          ◆
        </div>
      </button>

      {/* Provider buttons */}
      <div className="mt-2 flex flex-col gap-1">
        {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          const liveProvider = props.providers
            ? getProviderSnapshot(props.providers, option.value)
            : undefined;

          const isDisabled = liveProvider && liveProvider.status !== "ready";
          const isSelected = props.selectedProvider === option.value;

          return (
            <button
              key={option.value}
              className={cn(
                "flex items-center justify-center p-2 rounded transition-colors hover:bg-muted",
                isSelected && "bg-accent text-accent-foreground",
                isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
              )}
              onClick={() => !isDisabled && handleProviderClick(option.value)}
              title={option.label}
              disabled={isDisabled}
              type="button"
              aria-label={option.label}
            >
              <OptionIcon
                className={cn(
                  "size-5 shrink-0",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
                aria-hidden
              />
            </button>
          );
        })}

        {/* Gemini button (coming soon) */}
        <button
          className="flex items-center justify-center p-2 rounded opacity-50 cursor-not-allowed hover:bg-transparent transition-colors"
          disabled
          title="Gemini (coming soon)"
          type="button"
          aria-label="Gemini (coming soon)"
        >
          <Gemini className="size-5 shrink-0 text-muted-foreground/85" aria-hidden />
        </button>
      </div>

      {/* Favorites section */}
      <div className="mt-auto pt-2 border-t">
        <button
          className={cn(
            "w-full flex items-center justify-center p-2 rounded transition-colors hover:bg-muted",
            props.selectedProvider === "favorites" && "bg-accent text-accent-foreground",
          )}
          onClick={() => handleProviderClick("favorites")}
          title="Favorites"
          type="button"
          aria-label="Favorites"
        >
          <StarIcon className="size-5 shrink-0" aria-hidden />
        </button>
      </div>
    </div>
  );
});
