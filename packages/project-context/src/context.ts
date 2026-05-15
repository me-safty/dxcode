import * as Schema from "effect/Schema";

import { ExternalResourceRef } from "./resource.ts";

export const ContextAttachment = Schema.Struct({
  resourceRefs: Schema.Array(ExternalResourceRef),
  snapshots: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  customFields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type ContextAttachment = typeof ContextAttachment.Type;

export const ProjectProfile = Schema.Literals([
  "qa-assistant",
  "product-explainer",
  "developer-bridge",
]);
export type ProjectProfile = typeof ProjectProfile.Type;

export const ProjectMemoryDocument = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectMemoryDocument = typeof ProjectMemoryDocument.Type;
