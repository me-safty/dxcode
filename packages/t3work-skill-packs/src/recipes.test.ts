import { isRecipeApplicable, matchRecipes, type RecipeMatchInput } from "@t3tools/project-recipes";
import { describe, expect, it } from "vite-plus/test";

import { getBundledT3WorkRecipe, listBundledT3WorkRecipes } from "./recipes.js";

function buildMatchInput(overrides: Partial<RecipeMatchInput> = {}): RecipeMatchInput {
  return {
    activeProject: { source: { provider: "atlassian" } },
    selectedResource: null,
    resourceKind: "ticket",
    availableIntegrations: ["atlassian"],
    surface: "workitem.detail.sidepanel",
    jiraIssueType: "Epic",
    enabledSkillPacks: ["delivery", "product", "engineering"],
    profile: {
      technicalDepth: "medium",
      brevity: "balanced",
      guidanceStyle: "balanced",
      detailDensity: "balanced",
      preferredArtifactKinds: ["estimation-notes"],
      defaultActionFamilies: ["delivery", "product"],
      defaultRecipeWeights: {},
    },
    availableContextKeys: ["ticket.summary", "project.summary"],
    ...overrides,
  };
}

describe("tshirt-size-epic bundled recipe", () => {
  it("is present in the bundled catalog", () => {
    expect(getBundledT3WorkRecipe("tshirt-size-epic")).toBeDefined();
    expect(listBundledT3WorkRecipes().some((recipe) => recipe.id === "tshirt-size-epic")).toBe(
      true,
    );
  });

  it("is applicable for an Epic on workitem.detail.sidepanel when the epic has no children", () => {
    const recipe = getBundledT3WorkRecipe("tshirt-size-epic")!;
    expect(isRecipeApplicable(recipe, buildMatchInput({ epicHasChildren: false }))).toBe(true);
  });

  it("is applicable on the backlog dashboard surface for an Epic (signal unknown stays visible)", () => {
    const recipe = getBundledT3WorkRecipe("tshirt-size-epic")!;
    expect(
      isRecipeApplicable(recipe, buildMatchInput({ surface: "project.dashboard.backlog" })),
    ).toBe(true);
  });

  it("is NOT applicable for non-epic issue types", () => {
    const recipe = getBundledT3WorkRecipe("tshirt-size-epic")!;
    expect(isRecipeApplicable(recipe, buildMatchInput({ jiraIssueType: "Story" }))).toBe(false);
    expect(isRecipeApplicable(recipe, buildMatchInput({ jiraIssueType: "Bug" }))).toBe(false);
    expect(isRecipeApplicable(recipe, buildMatchInput({ jiraIssueType: null }))).toBe(false);
  });

  it("is hidden via matchRecipes when the epic already has children", () => {
    const results = matchRecipes(
      listBundledT3WorkRecipes(),
      buildMatchInput({ epicHasChildren: true }),
    );
    expect(results.map((result) => result.recipe.id)).not.toContain("tshirt-size-epic");
  });

  it("surfaces via matchRecipes for an un-sized epic and links the shape-next-backlog-slice follow-up", () => {
    const results = matchRecipes(
      listBundledT3WorkRecipes(),
      buildMatchInput({ epicHasChildren: false }),
    );
    const match = results.find((result) => result.recipe.id === "tshirt-size-epic");
    expect(match).toBeDefined();
    expect(match?.recipe.suggestedActions?.map((action) => action.recipeId)).toContain(
      "shape-next-backlog-slice",
    );
  });
});
