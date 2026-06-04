import type { PluginsInvokeInput, PluginsSubscribeInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PluginRegistryShape } from "./PluginRegistry.ts";

export const pluginList = (registry: PluginRegistryShape) =>
  registry.listCatalog.pipe(Effect.map((plugins) => ({ plugins })));

export const pluginInvoke = (registry: PluginRegistryShape, input: PluginsInvokeInput) =>
  registry
    .invoke(input.pluginId, input.command, input.input)
    .pipe(Effect.map((output) => ({ output })));

export const pluginSubscribe = (registry: PluginRegistryShape, input: PluginsSubscribeInput) =>
  registry.subscribe(input.pluginId);
