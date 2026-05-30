import type { BackendApi } from "~/t3work/backend/t3work-types";
import { T3workKickoffRecipeList } from "~/t3work/t3work-KickoffRecipeList";
import {
  orderT3workSidecarSectionItems,
  type T3workSidecarSectionShellProps,
} from "~/t3work/t3work-sidecarSectionShellProps";
import { useT3workSidecarRecipeQuickStarts } from "~/t3work/t3work-sidecarRecipes";
import type { T3workSidecarRecipeInput } from "~/t3work/t3work-sidecarRecipeTypes";
import type { T3workSidecarRecipeQuickStart } from "~/t3work/t3work-sidecarRecipeTypes";
import type { SidecarSectionHost } from "~/t3work/t3work-sidecarSectionHost";

export type QuickStartsSectionProps = {
  readonly recipeInput: T3workSidecarRecipeInput & {
    readonly backend: BackendApi | null;
  };
  readonly selectedRecipeId?: string | undefined;
  readonly shell?: T3workSidecarSectionShellProps<T3workSidecarRecipeQuickStart> | undefined;
};

function isQuickStartsSectionProps(props: unknown): props is QuickStartsSectionProps {
  return typeof props === "object" && props !== null && "recipeInput" in props;
}

function QuickStartsSectionContent({
  host,
  sectionProps,
}: {
  host: SidecarSectionHost;
  sectionProps: QuickStartsSectionProps;
}) {
  const quickStarts = useT3workSidecarRecipeQuickStarts(sectionProps.recipeInput);
  const orderedQuickStarts = orderT3workSidecarSectionItems({
    items: quickStarts,
    getItemId: (quickStart) => quickStart.id,
    shell: sectionProps.shell,
  });

  return (
    <T3workKickoffRecipeList
      recipes={orderedQuickStarts}
      {...(sectionProps.selectedRecipeId
        ? { selectedRecipeId: sectionProps.selectedRecipeId }
        : {})}
      onSelectRecipe={(recipe, customization) => host.stageKickoff(recipe, customization)}
      renderRecipe={
        sectionProps.shell?.wrapItem
          ? (recipe, content) => sectionProps.shell?.wrapItem?.(recipe, content) ?? content
          : undefined
      }
    />
  );
}

export function T3workQuickStartsSection({
  host,
  props,
}: {
  host: SidecarSectionHost;
  props?: unknown;
}) {
  if (!isQuickStartsSectionProps(props)) {
    return null;
  }

  return <QuickStartsSectionContent host={host} sectionProps={props} />;
}
