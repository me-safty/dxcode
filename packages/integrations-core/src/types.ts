import * as Schema from "effect/Schema";

export const IntegrationAccountRef = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
});
export type IntegrationAccountRef = typeof IntegrationAccountRef.Type;

export const IntegrationAccount = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  label: Schema.String,
  accountUrl: Schema.optional(Schema.String),
});
export type IntegrationAccount = typeof IntegrationAccount.Type;

export const ExternalProject = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  title: Schema.String,
  key: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.Unknown),
});
export type ExternalProject = typeof ExternalProject.Type;

export const ListResourcesInput = Schema.Struct({
  account: IntegrationAccountRef,
  externalProjectId: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  query: Schema.optional(Schema.String),
});
export type ListResourcesInput = typeof ListResourcesInput.Type;

export const IntegrationSearchInput = Schema.Struct({
  account: IntegrationAccountRef,
  query: Schema.String,
  externalProjectId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
});
export type IntegrationSearchInput = typeof IntegrationSearchInput.Type;

export const ResourceSearchResult = Schema.Struct({
  ref: Schema.Unknown,
  score: Schema.optional(Schema.Number),
});
export type ResourceSearchResult = typeof ResourceSearchResult.Type;

export const IntegrationAction = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["read", "write", "mutate"]),
  requiresApproval: Schema.optional(Schema.Boolean),
});
export type IntegrationAction = typeof IntegrationAction.Type;

export const PrepareMutationInput = Schema.Struct({
  ref: Schema.Unknown,
  actionId: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
export type PrepareMutationInput = typeof PrepareMutationInput.Type;

export const PreparedMutation = Schema.Struct({
  mutationId: Schema.String,
  preview: Schema.String,
  editableFields: Schema.Array(Schema.String),
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
export type PreparedMutation = typeof PreparedMutation.Type;

export const CommitMutationInput = Schema.Struct({
  mutationId: Schema.String,
  approvedPayload: Schema.Record(Schema.String, Schema.Unknown),
});
export type CommitMutationInput = typeof CommitMutationInput.Type;

export const MutationResult = Schema.Struct({
  success: Schema.Boolean,
  externalUrl: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
});
export type MutationResult = typeof MutationResult.Type;
