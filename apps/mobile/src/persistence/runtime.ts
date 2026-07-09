import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import * as EnvironmentCacheStore from "../connection/environment-cache-store";
import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";
import * as MobileSecureStorage from "./mobile-secure-storage";
import * as MobileStorage from "./mobile-storage";

const baseLayer = Layer.merge(MobileDatabase.layer, MobileSecureStorage.layer);
const dependentLayer = Layer.mergeAll(
  MobilePreferences.layer,
  MobileStorage.layer,
  EnvironmentCacheStore.layer,
).pipe(Layer.provide(baseLayer));

export const layer = Layer.merge(baseLayer, dependentLayer);

export const runtime = ManagedRuntime.make(layer);

/** Provides the app-owned persistence services to framework integration layers. */
export const contextLayer = Layer.effectContext(runtime.contextEffect);
