import * as Schema from "effect/Schema";

import { RecipeSurface } from "./surface.ts";

export const ActionRecipeSurface = RecipeSurface;
export type ActionRecipeSurface = typeof ActionRecipeSurface.Type;

export const SidecarSectionDefaults = Schema.Struct({
  collapsed: Schema.optional(Schema.Boolean),
  visible: Schema.optional(Schema.Boolean),
});
export type SidecarSectionDefaults = typeof SidecarSectionDefaults.Type;

export const SidecarSectionDefinition = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  title: Schema.String,
  shortDescription: Schema.optional(Schema.String),
  surfaces: Schema.Array(ActionRecipeSurface),
  component: Schema.String,
  allowedToolGroups: Schema.optional(Schema.Array(Schema.String)),
  defaults: Schema.optional(SidecarSectionDefaults),
});
export type SidecarSectionDefinition = typeof SidecarSectionDefinition.Type;

// Stage-1 trusted sections bind to a registered React component key here.
// This helper re-homes into the dedicated SDK package when that surface lands.
// Deferred to the later context-menu and miniapp-runtime phases:
// itemActions, sectionActions, settingsView, function titles, and view module paths.
export function defineSidecarSection(
  definition: SidecarSectionDefinition,
): SidecarSectionDefinition {
  return Schema.decodeSync(SidecarSectionDefinition)(definition);
}
