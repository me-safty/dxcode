import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const SkillScope = Schema.Literals(["admin", "repo", "system", "user"]);
export type SkillScope = typeof SkillScope.Type;

export const SkillDefinition = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
  defaultPrompt: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  scope: SkillScope,
  directoryPath: TrimmedNonEmptyString,
  skillFilePath: TrimmedNonEmptyString,
  agentsDefinitionPath: Schema.optional(TrimmedNonEmptyString),
});
export type SkillDefinition = typeof SkillDefinition.Type;

export const ServerListSkillsInput = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  homePath: Schema.optional(TrimmedNonEmptyString),
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type ServerListSkillsInput = typeof ServerListSkillsInput.Type;

export const ServerListSkillsResult = Schema.Struct({
  skills: Schema.Array(SkillDefinition),
});
export type ServerListSkillsResult = typeof ServerListSkillsResult.Type;
