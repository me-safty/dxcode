import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  getDesktopClerkFrontendApiHostname,
  isDesktopClerkBridgeEnabled,
  resolveDesktopClerkFrontendApiHostname,
} from "./DesktopClerkConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export {
  getDesktopClerkFrontendApiHostname,
  isDesktopClerkBridgeEnabled,
  resolveDesktopClerkFrontendApiHostname,
} from "./DesktopClerkConfig.ts";

export class DesktopClerkBridgeInitializationError extends Schema.TaggedErrorClass<DesktopClerkBridgeInitializationError>()(
  "DesktopClerkBridgeInitializationError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerkBridgeCleanupError extends Schema.TaggedErrorClass<DesktopClerkBridgeCleanupError>()(
  "DesktopClerkBridgeCleanupError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clean up the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
  }
>()("@t3tools/desktop/app/DesktopClerk") {}

export function createDesktopClerkBridge(stateDir: string, isDevelopment: boolean) {
  return createClerkBridge({
    storage: storage({ path: stateDir }),
    passkeys: true,
    renderer: {
      scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
      host: ElectronProtocol.DESKTOP_HOST,
    },
  });
}

export function makeDesktopClerkLayer(enabled = isDesktopClerkBridgeEnabled()) {
  const make = Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (enabled) {
      yield* Effect.acquireRelease(
        Effect.try({
          try: () => createDesktopClerkBridge(environment.stateDir, environment.isDevelopment),
          catch: (cause) =>
            new DesktopClerkBridgeInitializationError({
              stateDir: environment.stateDir,
              isDevelopment: environment.isDevelopment,
              cause,
            }),
        }),
        (bridge) =>
          Effect.try({
            try: () => bridge.cleanup(),
            catch: (cause) =>
              new DesktopClerkBridgeCleanupError({
                stateDir: environment.stateDir,
                isDevelopment: environment.isDevelopment,
                cause,
              }),
          }).pipe(Effect.orDie),
      );
    }

    return DesktopClerk.of({
      configure: Effect.gen(function* () {
        const electronApp = yield* ElectronApp.ElectronApp;
        const electronWindow = yield* ElectronWindow.ElectronWindow;
        const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
        const runPromise = Effect.runPromiseWith(context);

        if (!(yield* electronApp.requestSingleInstanceLock)) {
          yield* electronApp.quit;
          return yield* Effect.interrupt;
        }

        yield* electronApp.on("second-instance", () => {
          void runPromise(
            Effect.gen(function* () {
              const mainWindow = yield* electronWindow.currentMainOrFirst;
              if (Option.isSome(mainWindow)) {
                yield* electronWindow.reveal(mainWindow.value);
              }
            }),
          );
        });
      }).pipe(Effect.withSpan("desktop.clerk.configure")),
    });
  });

  return Layer.effect(DesktopClerk, make);
}

export const layer = makeDesktopClerkLayer();
