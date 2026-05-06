import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { autoUpdater } from "electron-updater";

type AutoUpdater = typeof autoUpdater;

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export interface ElectronUpdaterShape {
  readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
  readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
  readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
  readonly setChannel: (channel: string) => Effect.Effect<void>;
  readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
  readonly allowDowngrade: Effect.Effect<boolean>;
  readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
  readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
  readonly checkForUpdates: Effect.Effect<void, unknown>;
  readonly downloadUpdate: Effect.Effect<void, unknown>;
  readonly quitAndInstall: (options: {
    readonly isSilent: boolean;
    readonly isForceRunAfter: boolean;
  }) => Effect.Effect<void>;
  readonly on: <Args extends ReadonlyArray<unknown>>(
    eventName: string,
    listener: (...args: Args) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronUpdater extends Context.Service<ElectronUpdater, ElectronUpdaterShape>()(
  "t3/desktop/electron/Updater",
) {}

const fromPromise = <A>(evaluate: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.callback<A, unknown>((resume) => {
    evaluate().then(
      (value) => resume(Effect.succeed(value)),
      (error: unknown) => resume(Effect.fail(error)),
    );
  });

export const layer = Layer.succeed(ElectronUpdater, {
  setFeedURL: (options) =>
    Effect.sync(() => {
      autoUpdater.setFeedURL(options);
    }),
  setAutoDownload: (value) =>
    Effect.sync(() => {
      autoUpdater.autoDownload = value;
    }),
  setAutoInstallOnAppQuit: (value) =>
    Effect.sync(() => {
      autoUpdater.autoInstallOnAppQuit = value;
    }),
  setChannel: (channel) =>
    Effect.sync(() => {
      autoUpdater.channel = channel;
    }),
  setAllowPrerelease: (value) =>
    Effect.sync(() => {
      autoUpdater.allowPrerelease = value;
    }),
  allowDowngrade: Effect.sync(() => autoUpdater.allowDowngrade),
  setAllowDowngrade: (value) =>
    Effect.sync(() => {
      autoUpdater.allowDowngrade = value;
    }),
  setDisableDifferentialDownload: (value) =>
    Effect.sync(() => {
      autoUpdater.disableDifferentialDownload = value;
    }),
  checkForUpdates: fromPromise(() => autoUpdater.checkForUpdates()).pipe(Effect.asVoid),
  downloadUpdate: fromPromise(() => autoUpdater.downloadUpdate()).pipe(Effect.asVoid),
  quitAndInstall: ({ isSilent, isForceRunAfter }) =>
    Effect.sync(() => {
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
    }),
  on: (eventName, listener) => {
    const eventTarget = autoUpdater as unknown as {
      on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
      removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
    };
    const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
    return Effect.acquireRelease(
      Effect.sync(() => {
        eventTarget.on(eventName, untypedListener);
      }),
      () =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
        }),
    ).pipe(Effect.asVoid);
  },
} satisfies ElectronUpdaterShape);
