import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

export class ElectronWindowCreateError extends Schema.TaggedErrorClass<ElectronWindowCreateError>()(
  "ElectronWindowCreateError",
  {
    resource: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to create ${this.resource}.`;
  }
}

export class ElectronWindow extends Context.Service<
  ElectronWindow,
  {
    readonly create: (
      options: BrowserWindowConstructorOptions,
    ) => Effect.Effect<BrowserWindow, ElectronWindowCreateError>;
    readonly main: Effect.Effect<Option.Option<BrowserWindow>>;
    readonly currentMainOrFirst: Effect.Effect<Option.Option<BrowserWindow>>;
    readonly focusedMainOrFirst: Effect.Effect<Option.Option<BrowserWindow>>;
    readonly setMain: (window: BrowserWindow) => Effect.Effect<void>;
    readonly clearMain: (window: Option.Option<BrowserWindow>) => Effect.Effect<void>;
    readonly reveal: (window: BrowserWindow) => Effect.Effect<void>;
    readonly sendAll: (channel: string, ...args: readonly unknown[]) => Effect.Effect<void>;
    readonly destroyAll: Effect.Effect<void>;
    readonly syncAllAppearance: <E, R>(
      sync: (window: BrowserWindow) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<void, E, R>;
  }
>()("@t3tools/desktop/electron/ElectronWindow") {}

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  const mainWindowRef = yield* Ref.make<Option.Option<BrowserWindow>>(Option.none());

  const liveMain = Ref.get(mainWindowRef).pipe(
    Effect.map(Option.filter((value) => !value.isDestroyed())),
  );

  const currentMainOrFirst = Effect.gen(function* () {
    const main = yield* liveMain;
    if (Option.isSome(main)) {
      return main;
    }

    return Option.fromNullishOr(BrowserWindow.getAllWindows()[0] ?? null).pipe(
      Option.filter((window) => !window.isDestroyed()),
    );
  });

  const focusedMainOrFirst = Effect.sync(() =>
    Option.fromNullishOr(BrowserWindow.getFocusedWindow() ?? null).pipe(
      Option.filter((window) => !window.isDestroyed()),
    ),
  ).pipe(
    Effect.flatMap((focused) =>
      Option.isSome(focused) ? Effect.succeed(focused) : currentMainOrFirst,
    ),
  );

  return ElectronWindow.of({
    create: (options) =>
      Effect.try({
        try: () => new BrowserWindow(options),
        catch: (cause) =>
          new ElectronWindowCreateError({ resource: "Electron BrowserWindow", cause }),
      }),
    main: liveMain,
    currentMainOrFirst,
    focusedMainOrFirst,
    setMain: (window) => Ref.set(mainWindowRef, Option.some(window)),
    clearMain: (window) =>
      Ref.update(mainWindowRef, (current) => {
        if (Option.isNone(current)) {
          return current;
        }
        if (Option.isSome(window) && current.value !== window.value) {
          return current;
        }
        return Option.none();
      }),
    reveal: (window) =>
      Effect.sync(() => {
        if (window.isDestroyed()) {
          return;
        }

        if (window.isMinimized()) {
          window.restore();
        }

        if (!window.isVisible()) {
          window.show();
        }

        if (platform === "darwin") {
          app.focus({ steal: true });
        }

        window.focus();
      }),
    sendAll: (channel, ...args) =>
      Effect.sync(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) {
            continue;
          }
          window.webContents.send(channel, ...args);
        }
      }),
    destroyAll: Effect.sync(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy();
      }
    }),
    syncAllAppearance: Effect.fn("desktop.electron.window.syncAllAppearance")(function* <E, R>(
      sync: (window: BrowserWindow) => Effect.Effect<void, E, R>,
    ) {
      const windows = BrowserWindow.getAllWindows();
      for (const window of windows) {
        if (window.isDestroyed()) {
          continue;
        }
        yield* sync(window);
      }
    }),
  });
});

export const layer = Layer.effect(ElectronWindow, make);
