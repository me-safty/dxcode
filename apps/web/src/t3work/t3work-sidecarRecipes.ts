import type { ProjectShellProject } from "@t3tools/project-context";
import { matchRecipes, type RecipeSurface } from "@t3tools/project-recipes";
import {
  getT3WorkProfile,
  listBundledT3WorkRecipes,
  toRecipeProfileContext,
} from "@t3tools/t3work-skill-packs";

export type T3workSidecarRecipeQuickStart = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
};

function renderPromptTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(
    /{{\s*([a-zA-Z0-9]+)\s*}}/g,
    (_match, key: string) => values[key] ?? "selected work",
  );
}

export function buildT3workSidecarRecipeQuickStarts(input: {
  readonly surface: RecipeSurface;
  readonly project: ProjectShellProject;
  readonly profileId?: string;
  readonly selectedWorkLabel: string;
  readonly resourceKind?: string | null;
  readonly jiraIssueType?: string | null;
  readonly availableIntegrations?: ReadonlyArray<string>;
  readonly availableContextKeys?: ReadonlyArray<string>;
  readonly limit?: number;
}): ReadonlyArray<T3workSidecarRecipeQuickStart> {
  const profile = getT3WorkProfile(input.profileId);
  const matches = matchRecipes(listBundledT3WorkRecipes(), {
    activeProject: input.project,
    selectedResource: null,
    resourceKind: input.resourceKind ?? null,
    availableIntegrations: [
      ...new Set([input.project.source.provider, ...(input.availableIntegrations ?? [])]),
    ],
    surface: input.surface,
    ...(input.jiraIssueType ? { jiraIssueType: input.jiraIssueType } : {}),
    enabledSkillPacks: profile.recommendedSkillPackIds,
    profile: toRecipeProfileContext(profile),
    ...(input.availableContextKeys ? { availableContextKeys: input.availableContextKeys } : {}),
  });

  return matches.slice(0, input.limit ?? 5).map((result) => ({
    id: result.recipe.id,
    title: result.recipe.title,
    description: result.recipe.shortDescription,
    prompt: renderPromptTemplate(result.recipe.promptTemplate, {
      projectTitle: input.project.title,
      selectedWorkLabel: input.selectedWorkLabel,
    }),
  }));
}
