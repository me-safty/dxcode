import * as Schema from "effect/Schema";

export const ProjectShellProjectId = Schema.String.pipe(Schema.brand("ProjectShellProjectId"));
export type ProjectShellProjectId = typeof ProjectShellProjectId.Type;

export const ProjectSourceKind = Schema.Literals([
  "atlassian",
  "linear",
  "github",
  "local",
  "managed",
]);
export type ProjectSourceKind = typeof ProjectSourceKind.Type;

export const ProjectSource = Schema.Struct({
  provider: ProjectSourceKind,
  accountId: Schema.optional(Schema.String),
  externalProjectId: Schema.optional(Schema.String),
  externalProjectKey: Schema.optional(Schema.String),
  externalProjectUrl: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.Unknown),
});
export type ProjectSource = typeof ProjectSource.Type;

export const ManagedWorkspace = Schema.Struct({
  rootPath: Schema.String,
  createdAt: Schema.String,
});
export type ManagedWorkspace = typeof ManagedWorkspace.Type;

export const ProjectShellProject = Schema.Struct({
  id: ProjectShellProjectId,
  title: Schema.String,
  source: ProjectSource,
  workspace: Schema.optional(ManagedWorkspace),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectShellProject = typeof ProjectShellProject.Type;
