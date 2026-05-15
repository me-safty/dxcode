import * as Schema from "effect/Schema";

import type { ExternalResourceRef } from "@t3tools/project-context";

export const RecipeApplicability = Schema.Struct({
  resourceKinds: Schema.optional(Schema.Array(Schema.String)),
  projectSourceKinds: Schema.optional(Schema.Array(Schema.String)),
  projectProfiles: Schema.optional(Schema.Array(Schema.String)),
  requiresIntegration: Schema.optional(Schema.Array(Schema.String)),
});
export type RecipeApplicability = typeof RecipeApplicability.Type;

export const RecipeContextRequirement = Schema.Struct({
  key: Schema.String,
  description: Schema.String,
  optional: Schema.optional(Schema.Boolean),
});
export type RecipeContextRequirement = typeof RecipeContextRequirement.Type;

export const RichOutputPreference = Schema.Literals(["markdown", "blocks", "plan", "comment"]);
export type RichOutputPreference = typeof RichOutputPreference.Type;

export const SkillRef = Schema.Struct({
  id: Schema.String,
  version: Schema.optional(Schema.String),
});
export type SkillRef = typeof SkillRef.Type;

export const RecipeFollowup = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  recipeId: Schema.String,
});
export type RecipeFollowup = typeof RecipeFollowup.Type;

export const Recipe = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  shortDescription: Schema.String,
  appliesTo: RecipeApplicability,
  requiredContext: Schema.Array(RecipeContextRequirement),
  skillRef: SkillRef,
  outputPreference: RichOutputPreference,
  suggestedActions: Schema.optional(Schema.Array(RecipeFollowup)),
});
export type Recipe = typeof Recipe.Type;

export type RecipeMatchInput = {
  readonly activeProject: unknown;
  readonly selectedResource: ExternalResourceRef | null;
  readonly resourceKind: string | null;
  readonly availableIntegrations: ReadonlyArray<string>;
};

export type RecipeMatchResult = {
  readonly recipe: Recipe;
  readonly score: number;
  readonly reason: string;
  readonly missingContext: ReadonlyArray<string>;
};
