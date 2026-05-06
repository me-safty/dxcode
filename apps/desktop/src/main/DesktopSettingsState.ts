import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SynchronizedRef from "effect/SynchronizedRef";

import {
  type DesktopSettings,
  DEFAULT_DESKTOP_SETTINGS,
  readDesktopSettingsEffect,
  writeDesktopSettingsEffect,
} from "../desktopSettings.ts";
import { DesktopEnvironment } from "../desktopEnvironment.ts";

export interface DesktopSettingsStateShape {
  readonly get: Effect.Effect<DesktopSettings>;
  readonly set: (settings: DesktopSettings) => Effect.Effect<void>;
  readonly load: Effect.Effect<DesktopSettings, never, FileSystem.FileSystem | DesktopEnvironment>;
  readonly update: (
    f: (settings: DesktopSettings) => DesktopSettings,
  ) => Effect.Effect<DesktopSettings>;
  readonly updatePersisted: (
    f: (settings: DesktopSettings) => DesktopSettings,
  ) => Effect.Effect<
    DesktopSettings,
    unknown,
    FileSystem.FileSystem | Path.Path | DesktopEnvironment
  >;
}

export class DesktopSettingsState extends Context.Service<
  DesktopSettingsState,
  DesktopSettingsStateShape
>()("t3/desktop/SettingsState") {}

export const layer = Layer.effect(
  DesktopSettingsState,
  Effect.gen(function* () {
    const settingsRef = yield* SynchronizedRef.make(DEFAULT_DESKTOP_SETTINGS);

    const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
      SynchronizedRef.updateAndGet(settingsRef, f);

    return DesktopSettingsState.of({
      get: SynchronizedRef.get(settingsRef),
      set: (settings) => SynchronizedRef.set(settingsRef, settings),
      load: Effect.gen(function* () {
        const environment = yield* DesktopEnvironment;
        const settings = yield* readDesktopSettingsEffect(
          environment.desktopSettingsPath,
          environment.appVersion,
        );
        return yield* SynchronizedRef.setAndGet(settingsRef, settings);
      }),
      update,
      updatePersisted: (f) =>
        Effect.gen(function* () {
          const environment = yield* DesktopEnvironment;
          return yield* SynchronizedRef.modifyEffect(settingsRef, (settings) => {
            const nextSettings = f(settings);
            return writeDesktopSettingsEffect(environment.desktopSettingsPath, nextSettings).pipe(
              Effect.as([nextSettings, nextSettings] as const),
            );
          });
        }),
    });
  }),
);
