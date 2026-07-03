import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const GithubSelector = Schema.Struct({
  owner: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  labels: Schema.optional(Schema.Array(Schema.String)),
  assignee: Schema.optional(Schema.String),
  state: Schema.Literals(["all", "open"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("all" as const)),
  ),
});
export type GithubSelector = typeof GithubSelector.Type;

export const AsanaSelector = Schema.Struct({
  projectGid: TrimmedNonEmptyString,
  sectionGid: Schema.optional(Schema.String),
  tagGid: Schema.optional(Schema.String),
  includeCompleted: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type AsanaSelector = typeof AsanaSelector.Type;

export const JiraSelector = Schema.Struct({
  projectKey: TrimmedNonEmptyString,
  jql: Schema.optional(Schema.String),
});
export type JiraSelector = typeof JiraSelector.Type;
