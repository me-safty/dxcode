import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
  setSource: (theme) =>
    Effect.sync(() => {
      Electron.nativeTheme.themeSource = theme;
    }),
});

export const layer = Layer.succeed(ElectronTheme, make);
