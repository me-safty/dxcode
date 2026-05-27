import { listBundledT3WorkRecipes } from "@t3tools/t3work-skill-packs";

import {
  T3WORK_PROJECT_RECIPES_ROOT,
  type T3WorkProjectSetupFile,
} from "./t3work-projectSetupShared.ts";

function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderBundledRecipeManifest(
  recipe: ReturnType<typeof listBundledT3WorkRecipes>[number],
): string {
  return jsonFile({
    id: recipe.id,
    version: recipe.version,
    scope: "project",
    displayName: recipe.manifestDisplayName,
    shortDescription: recipe.shortDescription,
    ...(recipe.icon ? { icon: recipe.icon } : {}),
    surfaces: recipe.surfaces,
    prompt: "./prompt.md",
    allowedToolGroups: recipe.allowedToolGroups,
    outputPreference: recipe.outputPreference,
  });
}

function renderBundledRecipePrompt(
  recipe: ReturnType<typeof listBundledT3WorkRecipes>[number],
): string {
  return `# ${recipe.title}\n\n${recipe.shortDescription}\n\n## Prompt\n\n${recipe.promptTemplate}\n`;
}

export function renderBundledRecipeSetupFiles(): ReadonlyArray<T3WorkProjectSetupFile> {
  return listBundledT3WorkRecipes().flatMap((recipe) => [
    {
      relativePath: `${T3WORK_PROJECT_RECIPES_ROOT}/${recipe.id}/recipe.json`,
      contents: renderBundledRecipeManifest(recipe),
      writeMode: "if-missing",
    },
    {
      relativePath: `${T3WORK_PROJECT_RECIPES_ROOT}/${recipe.id}/prompt.md`,
      contents: renderBundledRecipePrompt(recipe),
      writeMode: "if-missing",
    },
  ]);
}
