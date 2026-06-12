import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { KimiCodeSettings } from "@t3tools/contracts";

import {
  buildInitialKimiCodeProviderSnapshot,
  checkKimiCodeProviderStatus,
} from "./KimiCodeProvider.ts";

const decodeKimiCodeSettings = Schema.decodeSync(KimiCodeSettings);

describe("buildInitialKimiCodeProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialKimiCodeProviderSnapshot(
        decodeKimiCodeSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a pending snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialKimiCodeProviderSnapshot(decodeKimiCodeSettings({}));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Kimi Code");
      expect(snapshot.showInteractionModeToggle).toBe(true);
    }),
  );

  it.effect("includes the default built-in model", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialKimiCodeProviderSnapshot(decodeKimiCodeSettings({}));
      expect(snapshot.models.map((model) => model.slug)).toContain("kimi-code/kimi-for-coding");
    }),
  );
});

it.layer(NodeServices.layer)("checkKimiCodeProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkKimiCodeProviderStatus(
        decodeKimiCodeSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/kimi-binary",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );

  it.effect("reports an installed CLI as unhealthy when --version exits non-zero", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-kimi-version-" });
          const kimiPath = path.join(dir, "kimi");
          yield* fs.writeFileString(
            kimiPath,
            ["#!/bin/sh", 'printf "%s\\n" "broken kimi install" >&2', "exit 2", ""].join("\n"),
          );
          yield* fs.chmod(kimiPath, 0o755);

          return yield* checkKimiCodeProviderStatus(
            decodeKimiCodeSettings({ enabled: true, binaryPath: kimiPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("broken kimi install");
    }),
  );

  it.effect("reports an error when ACP startup is unavailable", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-kimi-success-" });
          const kimiPath = path.join(dir, "kimi");
          yield* fs.writeFileString(
            kimiPath,
            ["#!/bin/sh", 'printf "kimi-cli 0.0.99\\n"', "exit 0", ""].join("\n"),
          );
          yield* fs.chmod(kimiPath, 0o755);

          return yield* checkKimiCodeProviderStatus(
            decodeKimiCodeSettings({ enabled: true, binaryPath: kimiPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.models.map((model) => model.slug)).toEqual(["kimi-code/kimi-for-coding"]);
      expect(snapshot.message).toContain("ACP startup failed");
    }),
  );
});
