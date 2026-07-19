import * as Schema from "effect/Schema";

import { PortSchema } from "./baseSchemas.ts";

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  // Omitted when the desktop launches the backend inside WSL, since the
  // Windows-side baseDir maps to /mnt/c/... and the Linux side should use its
  // own home directory instead.
  t3Home: Schema.optional(Schema.String),
  // Flavor-owned state directory beneath T3CODE_HOME. Constrained to one safe
  // path segment so the trusted desktop handoff cannot escape the base dir.
  stateDirName: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/))),
  // Keeps caches, managed worktrees, relays, and other base-dir consumers
  // beneath the flavor state directory. Omitted preserves production paths.
  isolateStateRoot: Schema.optional(Schema.Boolean),
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
  desktopFlavor: Schema.optional(Schema.Literals(["production", "development", "dx"])),
  installedSourceCommit: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/))),
  localDxUpdateCapable: Schema.optional(Schema.Boolean),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;
