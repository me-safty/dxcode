import type { RecipeSurface } from "@t3tools/project-recipes";

import type { T3workRecipeQuickStartLaunchCustomization } from "~/t3work/t3work-recipeQuickStartLaunch";
import type { T3workSidecarRecipeQuickStart } from "~/t3work/t3work-sidecarRecipes";

export type SidecarSectionPlacement = "sidecar.section";

export type SidecarSectionHost = {
  readonly placement: SidecarSectionPlacement;
  readonly surface: RecipeSurface;
  readonly projectId: string;
  readonly stageKickoff: (
    recipe: T3workSidecarRecipeQuickStart,
    customization?: T3workRecipeQuickStartLaunchCustomization,
  ) => void;
  readonly launchRecipe: (recipeId: string, parameters?: Record<string, unknown>) => void;
  readonly openThread: (threadId: string) => void;
};

export function buildSidecarSectionHost(host: SidecarSectionHost): SidecarSectionHost {
  return host;
}
