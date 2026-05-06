import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "../../desktopEnvironment.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopLocalEnvironment from "../../main/DesktopLocalEnvironment.ts";
import * as DesktopWindowIpc from "./window.ts";

export const layer = Layer.effect(
  DesktopWindowIpc.DesktopWindowIpcActions,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const localEnvironment = yield* DesktopLocalEnvironment.DesktopLocalEnvironment;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const electronMenu = yield* ElectronMenu.ElectronMenu;
    const electronShell = yield* ElectronShell.ElectronShell;
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    const electronWindow = yield* ElectronWindow.ElectronWindow;

    return DesktopWindowIpc.DesktopWindowIpcActions.of({
      getAppBranding: Effect.succeed(environment.branding),
      getLocalEnvironmentBootstrap: localEnvironment.bootstrap.pipe(Effect.map(Option.getOrNull)),
      pickFolder: (options) =>
        Effect.gen(function* () {
          const selectedPath = yield* electronDialog.pickFolder({
            owner: yield* electronWindow.focusedMainOrFirst,
            defaultPath: environment.resolvePickFolderDefaultPath(options),
          });
          return Option.getOrNull(selectedPath);
        }),
      confirm: (message) =>
        Effect.gen(function* () {
          return yield* electronDialog.confirm({
            owner: yield* electronWindow.focusedMainOrFirst,
            message,
          });
        }),
      setTheme: (theme) => electronTheme.setSource(theme),
      showContextMenu: ({ items, position }) =>
        Effect.gen(function* () {
          const window = yield* electronWindow.focusedMainOrFirst;
          if (Option.isNone(window)) {
            return null;
          }

          const selectedItemId = yield* electronMenu.showContextMenu({
            window: window.value,
            items,
            position: Option.fromNullishOr(position),
          });
          return Option.getOrNull(selectedItemId);
        }),
      openExternal: (url) => electronShell.openExternal(url),
    });
  }),
);
