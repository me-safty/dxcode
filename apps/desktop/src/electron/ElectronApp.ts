import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { app, type AboutPanelOptionsOptions, type App, type RelaunchOptions } from "electron";

export interface ElectronAppMetadata {
  readonly appVersion: string;
  readonly appPath: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly runningUnderArm64Translation: boolean;
}

export class ElectronApp extends Context.Service<
  ElectronApp,
  {
    readonly metadata: Effect.Effect<ElectronAppMetadata>;
    readonly name: Effect.Effect<string>;
    readonly whenReady: Effect.Effect<void>;
    readonly quit: Effect.Effect<void>;
    readonly exit: (code: number) => Effect.Effect<void>;
    readonly relaunch: (options: RelaunchOptions) => Effect.Effect<void>;
    readonly setPath: (name: Parameters<App["setPath"]>[0], path: string) => Effect.Effect<void>;
    readonly setName: (name: string) => Effect.Effect<void>;
    readonly setAboutPanelOptions: (options: AboutPanelOptionsOptions) => Effect.Effect<void>;
    readonly setAppUserModelId: (id: string) => Effect.Effect<void>;
    readonly requestSingleInstanceLock: Effect.Effect<boolean>;
    readonly isDefaultProtocolClient: (protocol: string) => Effect.Effect<boolean>;
    readonly setAsDefaultProtocolClient: (
      protocol: string,
      path?: string,
      args?: readonly string[],
    ) => Effect.Effect<boolean>;
    readonly setDesktopName: (desktopName: string) => Effect.Effect<void>;
    readonly setDockIcon: (iconPath: string) => Effect.Effect<void>;
    readonly appendCommandLineSwitch: (switchName: string, value?: string) => Effect.Effect<void>;
    readonly on: <Args extends ReadonlyArray<unknown>>(
      eventName: string,
      listener: (...args: Args) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronApp") {}

const addScopedAppListener = <Args extends ReadonlyArray<unknown>>(
  eventName: string,
  listener: (...args: Args) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      app.on(eventName as any, listener as any);
    }),
    () =>
      Effect.sync(() => {
        app.removeListener(eventName as any, listener as any);
      }),
  ).pipe(Effect.asVoid);

export const make = ElectronApp.of({
  metadata: Effect.sync(() => ({
    appVersion: app.getVersion(),
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    runningUnderArm64Translation: app.runningUnderARM64Translation === true,
  })),
  name: Effect.sync(() => app.name),
  whenReady: Effect.promise(() => app.whenReady()).pipe(Effect.asVoid),
  quit: Effect.sync(() => {
    app.quit();
  }),
  exit: (code) =>
    Effect.sync(() => {
      app.exit(code);
    }),
  relaunch: (options) =>
    Effect.sync(() => {
      app.relaunch(options);
    }),
  setPath: (name, path) =>
    Effect.sync(() => {
      app.setPath(name, path);
    }),
  setName: (name) =>
    Effect.sync(() => {
      app.setName(name);
    }),
  setAboutPanelOptions: (options) =>
    Effect.sync(() => {
      app.setAboutPanelOptions(options);
    }),
  setAppUserModelId: (id) =>
    Effect.sync(() => {
      app.setAppUserModelId(id);
    }),
  requestSingleInstanceLock: Effect.sync(() => app.requestSingleInstanceLock()),
  isDefaultProtocolClient: (protocol) => Effect.sync(() => app.isDefaultProtocolClient(protocol)),
  setAsDefaultProtocolClient: (protocol, path, args) =>
    Effect.sync(() => {
      if (path === undefined) {
        return app.setAsDefaultProtocolClient(protocol);
      }
      return app.setAsDefaultProtocolClient(protocol, path, [...(args ?? [])]);
    }),
  setDesktopName: (desktopName) =>
    Effect.sync(() => {
      const linuxApp = app as App & {
        setDesktopName?: (desktopName: string) => void;
      };
      linuxApp.setDesktopName?.(desktopName);
    }),
  setDockIcon: (iconPath) =>
    Effect.sync(() => {
      app.dock?.setIcon(iconPath);
    }),
  appendCommandLineSwitch: (switchName, value) =>
    Effect.sync(() => {
      if (value === undefined) {
        app.commandLine.appendSwitch(switchName);
        return;
      }
      app.commandLine.appendSwitch(switchName, value);
    }),
  on: addScopedAppListener,
});

export const layer = Layer.succeed(ElectronApp, make);
