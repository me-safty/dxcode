import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PLUGIN_ID_MAX_CHARS = 96;
const PLUGIN_ROUTE_ID_MAX_CHARS = 64;
const PLUGIN_COMMAND_MAX_CHARS = 128;
const PLUGIN_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export const PluginId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PLUGIN_ID_MAX_CHARS),
  Schema.isPattern(PLUGIN_SLUG_PATTERN),
).pipe(Schema.brand("PluginId"));
export type PluginId = typeof PluginId.Type;

export const PluginRouteId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PLUGIN_ROUTE_ID_MAX_CHARS),
  Schema.isPattern(PLUGIN_SLUG_PATTERN),
).pipe(Schema.brand("PluginRouteId"));
export type PluginRouteId = typeof PluginRouteId.Type;

export const PluginCommandName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PLUGIN_COMMAND_MAX_CHARS),
  Schema.isPattern(PLUGIN_SLUG_PATTERN),
).pipe(Schema.brand("PluginCommandName"));
export type PluginCommandName = typeof PluginCommandName.Type;

export const PluginRouteContribution = Schema.Struct({
  id: PluginRouteId,
  label: TrimmedNonEmptyString,
});
export type PluginRouteContribution = typeof PluginRouteContribution.Type;

export const PluginNavContribution = Schema.Struct({
  id: PluginRouteId,
  label: TrimmedNonEmptyString,
  routeId: PluginRouteId,
  badgeCount: Schema.optional(NonNegativeInt),
});
export type PluginNavContribution = typeof PluginNavContribution.Type;

export const PluginCommandContribution = Schema.Struct({
  name: PluginCommandName,
  label: TrimmedNonEmptyString,
});
export type PluginCommandContribution = typeof PluginCommandContribution.Type;

export const PluginManifest = Schema.Struct({
  id: PluginId,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  routes: Schema.Array(PluginRouteContribution),
  nav: Schema.Array(PluginNavContribution),
  commands: Schema.Array(PluginCommandContribution),
});
export type PluginManifest = typeof PluginManifest.Type;

export const PluginStatus = Schema.Struct({
  pluginId: PluginId,
  status: Schema.Literals(["active", "failed", "disabled"]),
  diagnostics: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type PluginStatus = typeof PluginStatus.Type;

export const PluginCatalogEntry = Schema.Struct({
  manifest: PluginManifest,
  status: PluginStatus,
  assets: Schema.Struct({
    client: TrimmedNonEmptyString,
  }),
});
export type PluginCatalogEntry = typeof PluginCatalogEntry.Type;

export const PluginsListInput = Schema.Struct({});
export type PluginsListInput = typeof PluginsListInput.Type;

export const PluginsListResult = Schema.Struct({
  plugins: Schema.Array(PluginCatalogEntry),
});
export type PluginsListResult = typeof PluginsListResult.Type;

export const PluginsInvokeInput = Schema.Struct({
  pluginId: PluginId,
  command: PluginCommandName,
  input: Schema.Unknown,
});
export type PluginsInvokeInput = typeof PluginsInvokeInput.Type;

export const PluginsInvokeResult = Schema.Struct({
  output: Schema.Unknown,
});
export type PluginsInvokeResult = typeof PluginsInvokeResult.Type;

export const PluginsSubscribeInput = Schema.Struct({
  pluginId: Schema.optional(PluginId),
});
export type PluginsSubscribeInput = typeof PluginsSubscribeInput.Type;

export const PluginSubscriptionEvent = Schema.Struct({
  pluginId: PluginId,
  type: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type PluginSubscriptionEvent = typeof PluginSubscriptionEvent.Type;

export class PluginRpcError extends Schema.TaggedErrorClass<PluginRpcError>()("PluginRpcError", {
  message: TrimmedNonEmptyString,
  pluginId: Schema.optional(PluginId),
  command: Schema.optional(PluginCommandName),
  cause: Schema.optional(Schema.Defect),
}) {}
