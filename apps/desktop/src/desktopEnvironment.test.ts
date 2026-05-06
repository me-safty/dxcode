import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as EffectPath from "effect/Path";

import { makeDesktopEnvironment, resolveDesktopHomeDirectory } from "./desktopEnvironment.ts";

const makeEnvironment = (overrides: Partial<Parameters<typeof makeDesktopEnvironment>[0]> = {}) =>
  makeDesktopEnvironment({
    dirname: "/repo/apps/desktop/dist-electron",
    env: {},
    cwd: "/cwd",
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.0.22",
    appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
    isPackaged: false,
    resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
    runningUnderArm64Translation: false,
    ...overrides,
  }).pipe(Effect.provide(EffectPath.layer));

describe("DesktopEnvironment", () => {
  it("resolves home directory from platform env with cwd fallback", () => {
    assert.equal(
      resolveDesktopHomeDirectory({
        env: { HOME: " /Users/alice " },
        cwd: "/cwd",
      }),
      "/Users/alice",
    );
    assert.equal(resolveDesktopHomeDirectory({ env: {}, cwd: "/cwd" }), "/cwd");
  });

  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        env: {
          HOME: "/Users/alice",
          T3CODE_HOME: " /tmp/t3 ",
          VITE_DEV_SERVER_URL: " http://localhost:5173 ",
          T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH: " /remote/server.mjs ",
        },
      });

      assert.equal(environment.isDevelopment, true);
      assert.equal(environment.baseDir, "/tmp/t3");
      assert.equal(environment.stateDir, "/tmp/t3/userdata");
      assert.equal(environment.desktopSettingsPath, "/tmp/t3/userdata/desktop-settings.json");
      assert.equal(environment.clientSettingsPath, "/tmp/t3/userdata/client-settings.json");
      assert.equal(
        environment.savedEnvironmentRegistryPath,
        "/tmp/t3/userdata/saved-environments.json",
      );
      assert.equal(environment.serverSettingsPath, "/tmp/t3/userdata/settings.json");
      assert.equal(environment.logDir, "/tmp/t3/userdata/logs");
      assert.equal(environment.rootDir, "/repo");
      assert.equal(environment.appRoot, "/repo");
      assert.equal(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assert.equal(environment.backendCwd, "/repo");
      assert.equal(environment.appUserModelId, "com.t3tools.t3code.dev");
      assert.equal(environment.linuxWmClass, "t3code-dev");
      assert.deepEqual(environment.devServerUrl, Option.some("http://localhost:5173"));
      assert.deepEqual(environment.devRemoteT3ServerEntryPath, Option.some("/remote/server.mjs"));
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        env: { HOME: "/Users/alice" },
      });

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});
