import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import * as DesktopBackendManager from "../desktopBackendManager.ts";
import * as DesktopLocalEnvironment from "./DesktopLocalEnvironment.ts";

const backendConfig: DesktopBackendManager.DesktopBackendStartConfig = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: { ELECTRON_RUN_AS_NODE: "1" },
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
};

const makeLayer = (currentConfig: Option.Option<DesktopBackendManager.DesktopBackendStartConfig>) =>
  DesktopLocalEnvironment.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DesktopBackendManager.DesktopBackendManager,
        DesktopBackendManager.DesktopBackendManager.of({
          start: Effect.void,
          stop: () => Effect.void,
          shutdown: Effect.void,
          currentConfig: Effect.succeed(currentConfig),
          snapshot: Effect.succeed({
            desiredRunning: false,
            ready: false,
            activePid: Option.none(),
            restartAttempt: 0,
            restartScheduled: false,
            shuttingDown: false,
          }),
        }),
      ),
    ),
  );

describe("DesktopLocalEnvironment", () => {
  it.effect("returns none before the backend config has been resolved", () =>
    Effect.gen(function* () {
      const localEnvironment = yield* DesktopLocalEnvironment.DesktopLocalEnvironment;

      assert.isTrue(Option.isNone(yield* localEnvironment.bootstrap));
    }).pipe(Effect.provide(makeLayer(Option.none()))),
  );

  it.effect("derives the local bootstrap from the current backend config", () =>
    Effect.gen(function* () {
      const localEnvironment = yield* DesktopLocalEnvironment.DesktopLocalEnvironment;
      const bootstrap = yield* localEnvironment.bootstrap;

      assert.deepEqual(Option.getOrThrow(bootstrap), {
        label: "Local environment",
        httpBaseUrl: "http://127.0.0.1:3773/",
        wsBaseUrl: "ws://127.0.0.1:3773/",
        bootstrapToken: "token",
      });
    }).pipe(Effect.provide(makeLayer(Option.some(backendConfig)))),
  );

  it.effect("uses wss when the backend base URL is https", () =>
    Effect.gen(function* () {
      const localEnvironment = yield* DesktopLocalEnvironment.DesktopLocalEnvironment;
      const bootstrap = yield* localEnvironment.bootstrap;

      assert.equal(Option.getOrThrow(bootstrap).wsBaseUrl, "wss://example.test/");
    }).pipe(
      Effect.provide(
        makeLayer(
          Option.some({
            ...backendConfig,
            httpBaseUrl: new URL("https://example.test"),
          }),
        ),
      ),
    ),
  );
});
