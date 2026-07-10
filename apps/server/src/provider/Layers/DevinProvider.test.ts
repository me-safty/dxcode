import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { DevinSettings } from "@t3tools/contracts";

import {
  buildDevinDiscoveredModelsFromConfigOptions,
  buildInitialDevinProviderSnapshot,
  checkDevinProviderStatus,
  parseDevinAuthStatusOutput,
} from "./DevinProvider.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

describe("buildInitialDevinProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialDevinProviderSnapshot(
        decodeDevinSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a pending snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialDevinProviderSnapshot(decodeDevinSettings({}));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Devin");
      expect(snapshot.showInteractionModeToggle).toBe(false);
    }),
  );
});

describe("parseDevinAuthStatusOutput", () => {
  it("detects a logged-in CLI and extracts the account email", () => {
    const output = [
      "Logged in (via API key).",
      "",
      "Credentials:",
      "  File:              /Users/dev/.local/share/devin/credentials.toml",
      "",
      "User:",
      "  Name:              Dev User",
      "  Email:             dev@example.com",
    ].join("\n");

    expect(parseDevinAuthStatusOutput(output)).toEqual({
      status: "authenticated",
      email: "dev@example.com",
    });
  });

  it("detects a logged-out CLI", () => {
    const output = [
      "Not logged in.",
      "  Credentials path: /Users/dev/.local/share/devin/credentials.toml",
      "Run `devin auth login` to authenticate.",
    ].join("\n");

    expect(parseDevinAuthStatusOutput(output)).toEqual({ status: "unauthenticated" });
  });

  it("returns unknown for unrecognized output", () => {
    expect(parseDevinAuthStatusOutput("devin 3000.1.27 (0d4bf12e)")).toEqual({
      status: "unknown",
    });
  });
});

describe("buildDevinDiscoveredModelsFromConfigOptions", () => {
  it("flattens the model config option and filters dev-only entries", () => {
    const models = buildDevinDiscoveredModelsFromConfigOptions([
      {
        id: "mode",
        name: "Session Mode",
        category: "mode",
        type: "select",
        currentValue: "accept-edits",
        options: [{ value: "accept-edits", name: "Code" }],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "adaptive",
        options: [
          { value: "adaptive", name: "Adaptive" },
          { value: "claude-opus-4-8-high", name: "Claude Opus 4.8 High" },
          { value: "adaptive-dev", name: "Adaptive [dev]" },
          { value: "claude-opus-4-8-high", name: "Duplicate Opus" },
        ],
      },
    ]);

    expect(models.map((model) => model.slug)).toEqual(["adaptive", "claude-opus-4-8-high"]);
    expect(models.map((model) => model.name)).toEqual(["Adaptive", "Claude Opus 4.8 High"]);
  });

  it("returns no models when the model config option is missing", () => {
    expect(buildDevinDiscoveredModelsFromConfigOptions(undefined)).toEqual([]);
    expect(buildDevinDiscoveredModelsFromConfigOptions([])).toEqual([]);
  });
});

it.layer(NodeServices.layer)("checkDevinProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(
        decodeDevinSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/devin-binary",
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
      const secretStderr = "broken devin install: secret-token-value";
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-devin-version-" });
          const devinPath = path.join(dir, "devin");
          yield* fs.writeFileString(
            devinPath,
            ["#!/bin/sh", `printf "%s\\n" "${secretStderr}" >&2`, "exit 2", ""].join("\n"),
          );
          yield* fs.chmod(devinPath, 0o755);

          return yield* checkDevinProviderStatus(
            decodeDevinSettings({ enabled: true, binaryPath: devinPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Devin CLI is installed but failed to run.");
      expect(snapshot.message).not.toContain(secretStderr);
    }),
  );

  it.effect("reports a logged-out CLI without attempting ACP model discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-devin-logged-out-" });
          const devinPath = path.join(dir, "devin");
          yield* fs.writeFileString(
            devinPath,
            [
              "#!/bin/sh",
              'if [ "$1" = "auth" ]; then',
              '  printf "Not logged in.\\n"',
              "  exit 0",
              "fi",
              'printf "devin 3000.1.27 (0d4bf12e)\\n"',
              "exit 0",
              "",
            ].join("\n"),
          );
          yield* fs.chmod(devinPath, 0o755);

          return yield* checkDevinProviderStatus(
            decodeDevinSettings({ enabled: true, binaryPath: devinPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("warning");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBe("3000.1.27");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("devin auth login");
    }),
  );

  it.effect("reports an error when ACP model discovery is unavailable", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-devin-success-" });
          const devinPath = path.join(dir, "devin");
          yield* fs.writeFileString(
            devinPath,
            [
              "#!/bin/sh",
              'if [ "$1" = "auth" ]; then',
              '  printf "Logged in (via API key).\\n"',
              "  exit 0",
              "fi",
              'printf "devin 3000.1.27 (0d4bf12e)\\n"',
              "exit 0",
              "",
            ].join("\n"),
          );
          yield* fs.chmod(devinPath, 0o755);

          return yield* checkDevinProviderStatus(
            decodeDevinSettings({ enabled: true, binaryPath: devinPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["adaptive"]);
      expect(snapshot.message).toContain("ACP startup failed");
    }),
  );
});
