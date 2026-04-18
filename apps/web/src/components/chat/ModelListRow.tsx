import { type ProviderKind } from "@t3tools/contracts";
import { memo } from "react";
import { StarIcon } from "lucide-react";
import {
  PROVIDER_ICON_BY_PROVIDER,
  providerIconClassName,
  getProviderLabel,
  getDisplayModelName,
} from "./providerIconUtils";
import { cn } from "~/lib/utils";

export const ModelListRow = memo(function ModelListRow(props: {
  slug: string;
  name: string;
  provider: ProviderKind;
  isSelected: boolean;
  isFavorite: boolean;
  showProvider: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.provider];

  return (
    <div
      className={cn(
        "w-full px-3 py-2 rounded transition-colors flex items-start gap-2 group",
        !props.isSelected && "hover:bg-muted",
        props.isSelected && "bg-accent",
      )}
    >
      <button
        className="shrink-0 mt-0.5 opacity-40 group-hover:opacity-100 transition-opacity"
        onClick={props.onToggleFavorite}
        type="button"
        aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <StarIcon className={cn("size-4", props.isFavorite && "fill-current text-yellow-500")} />
      </button>

      <button className="min-w-0 flex-1 text-left" onClick={props.onSelect} type="button">
        <div className="font-medium text-sm truncate">
          {getDisplayModelName(props.provider, props.name)}
        </div>
        {props.showProvider && (
          <div className="flex items-center gap-1 mt-0.5">
            <ProviderIcon
              className={cn(
                "size-3 shrink-0",
                providerIconClassName(props.provider, "text-muted-foreground/70"),
              )}
            />
            <span className="text-xs text-muted-foreground/70 truncate">
              {getProviderLabel(props.provider, props.name)}
            </span>
          </div>
        )}
      </button>
    </div>
  );
});
