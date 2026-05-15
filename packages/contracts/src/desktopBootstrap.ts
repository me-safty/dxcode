import * as Schema from "effect/Schema";

import { PortSchema, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DesktopBootstrapWorkspaceFolder = Schema.Struct({
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  uriScheme: TrimmedNonEmptyString,
  uriAuthority: Schema.String,
});
export type DesktopBootstrapWorkspaceFolder = typeof DesktopBootstrapWorkspaceFolder.Type;

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  t3Home: Schema.String,
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
  workspaceFolders: Schema.optional(Schema.Array(DesktopBootstrapWorkspaceFolder)),
  activeWorkspaceFolderKey: Schema.optional(TrimmedNonEmptyString),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;
