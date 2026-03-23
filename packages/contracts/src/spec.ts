import { Schema } from "effect";
import { ProjectId, TrimmedNonEmptyString, IsoDateTime } from "./baseSchemas";

export const Spec = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  content: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Spec = typeof Spec.Type;

export const SpecGetInput = Schema.Struct({
  projectId: ProjectId,
});
export type SpecGetInput = typeof SpecGetInput.Type;

export const SpecUpdateInput = Schema.Struct({
  projectId: ProjectId,
  content: Schema.String,
});
export type SpecUpdateInput = typeof SpecUpdateInput.Type;

export const SPEC_WS_METHODS = {
  specGet: "spec.get",
  specUpdate: "spec.update",
} as const;
