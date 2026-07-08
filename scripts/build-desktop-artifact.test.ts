// @effect-diagnostics nodeBuiltinImport:off - Test creates a pnpm-style symlink layout.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  BuildCommandFailedError,
  createStageWorkspaceConfig,
  createStagePnpmConfig,
  createBuildConfig,
  DESKTOP_ASAR_UNPACK,
  InvalidMacPasskeyRpDomainError,
  InvalidMacPasskeyPublishableKeyError,
  InvalidMockUpdateServerPortError,
  isMacPasskeySigningConfigurationError,
  LinuxIconResizeError,
  MacPasskeySigningConfigurationResolutionError,
  MissingMacPasskeyProvisioningProfileError,
  renderMacPasskeyEntitlements,
  resolveClerkPasskeyNativeArtifacts,
  resolveDesktopStageDependencies,
  resolveMacPasskeySigningConfiguration,
  resolveDesktopRuntimeDependencies,
  resolveFfiRsNativeDependencies,
  resolveFffNativeDependencies,
  resolveBuildOptions,
  resolveDesktopBuildIconAssets,
  resolveDesktopProductName,
  resolveDesktopUpdateChannel,
  resolveGitHubPublishConfig,
  resolveKnownStagedRuntimeDependencies,
  resolveMockUpdateServerPort,
  resolveMockUpdateServerUrl,
  resolveStagedDependencyClosure,
  stageLinuxIconSize,
  STAGE_INSTALL_ARGS,
} from "./build-desktop-artifact.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";

function mockProcess(exitCode: number) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function iconResizeSpawnerLayer(
  commands: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>,
  exitCodes: ReadonlyArray<number>,
) {
  let commandIndex = 0;
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
      };
      commands.push({
        command: childProcess.command,
        args: childProcess.args,
      });
      return Effect.succeed(mockProcess(exitCodes[commandIndex++] ?? 0));
    }),
  );
}

it.layer(NodeServices.layer)("build-desktop-artifact", (it) => {
  it("resolves the dedicated nightly updater channel from nightly versions", () => {
    assert.equal(resolveDesktopUpdateChannel("0.0.17-nightly.20260413.42"), "nightly");
    assert.equal(resolveDesktopUpdateChannel("0.0.17"), "latest");
  });

  it("switches desktop packaging product names to nightly for nightly builds", () => {
    assert.equal(resolveDesktopProductName("0.0.17"), "T3 Code (Alpha)");
    assert.equal(resolveDesktopProductName("0.0.17-nightly.20260413.42"), "T3 Code (Nightly)");
  });

  it("switches desktop packaging icons to the nightly artwork for nightly versions", () => {
    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17"), {
      macIconPng: BRAND_ASSET_PATHS.productionMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    });

    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17-nightly.20260413.42"), {
      macIconPng: BRAND_ASSET_PATHS.nightlyMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    });
  });

  it.effect("resolves GitHub desktop publish config from Effect config", () =>
    Effect.gen(function* () {
      const latestConfig = yield* resolveGitHubPublishConfig("latest").pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                T3CODE_DESKTOP_UPDATE_REPOSITORY: "pingdotgg/t3code",
              },
            }),
          ),
        ),
      );
      const nightlyConfig = yield* resolveGitHubPublishConfig("nightly").pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                GITHUB_REPOSITORY: "pingdotgg/t3code",
              },
            }),
          ),
        ),
      );

      assert.deepStrictEqual(latestConfig, {
        provider: "github",
        owner: "pingdotgg",
        repo: "t3code",
        releaseType: "release",
      });
      assert.deepStrictEqual(nightlyConfig, {
        provider: "github",
        owner: "pingdotgg",
        repo: "t3code",
        releaseType: "prerelease",
        channel: "nightly",
      });
    }),
  );

  it("omits bundled workspace packages from staged desktop dependencies", () => {
    assert.deepStrictEqual(
      resolveDesktopRuntimeDependencies(
        {
          "@effect/platform-node": "catalog:",
          "@t3tools/contracts": "workspace:*",
          "@t3tools/shared": "workspace:*",
          "@t3tools/ssh": "workspace:*",
          "@t3tools/tailscale": "workspace:*",
          effect: "catalog:",
          electron: "41.5.0",
        },
        {
          "@effect/platform-node": "4.0.0-beta.59",
          effect: "4.0.0-beta.59",
        },
      ),
      {
        "@effect/platform-node": "4.0.0-beta.59",
        effect: "4.0.0-beta.59",
      },
    );
  });

  it("promotes installed production dependency closure into staged desktop dependencies", () => {
    const packages = new Map([
      [
        "effect",
        {
          packageJsonPath: "/store/effect/package.json",
          manifest: {
            version: "4.0.0-beta.78",
            dependencies: {
              "find-my-way-ts": "^0.1.6",
              "fast-check": "^4.8.0",
            },
          },
        },
      ],
      [
        "fast-check",
        {
          packageJsonPath: "/store/fast-check/package.json",
          manifest: {
            version: "4.8.0",
            dependencies: {
              "pure-rand": "^8.0.0",
            },
          },
        },
      ],
      [
        "find-my-way-ts",
        {
          packageJsonPath: "/store/find-my-way-ts/package.json",
          manifest: {
            version: "0.1.6",
          },
        },
      ],
      [
        "pure-rand",
        {
          packageJsonPath: "/store/pure-rand/package.json",
          manifest: {
            version: "8.4.0",
          },
        },
      ],
    ]);

    assert.deepStrictEqual(
      resolveStagedDependencyClosure(
        {
          effect: "4.0.0-beta.78",
        },
        ["/repo/apps/server/package.json"],
        (packageName) => packages.get(packageName),
      ),
      {
        effect: "4.0.0-beta.78",
        "fast-check": "4.8.0",
        "find-my-way-ts": "0.1.6",
        "pure-rand": "8.4.0",
      },
    );
  });

  it("preserves issuer package paths while walking staged dependency closure", () => {
    const packages = new Map([
      [
        "@malept/cross-spawn-promise",
        {
          packageJsonPath: "/store/cross-spawn-promise/package.json",
          manifest: {
            version: "2.0.0",
            dependencies: {
              "cross-spawn": "^7.0.1",
            },
          },
        },
      ],
      [
        "cross-spawn",
        {
          packageJsonPath: "/store/cross-spawn/package.json",
          manifest: {
            version: "7.0.6",
            dependencies: {
              which: "^2.0.1",
            },
          },
        },
      ],
      [
        "which",
        {
          packageJsonPath: "/store/which/package.json",
          manifest: {
            version: "2.0.2",
          },
        },
      ],
    ]);

    assert.deepStrictEqual(
      resolveStagedDependencyClosure(
        {
          "@malept/cross-spawn-promise": "2.0.0",
        },
        ["/repo/apps/server/package.json"],
        (packageName, packageJsonPaths) => {
          if (packageName === "@malept/cross-spawn-promise") {
            return packages.get(packageName);
          }
          if (
            packageName === "cross-spawn" &&
            packageJsonPaths.includes("/store/cross-spawn-promise/package.json")
          ) {
            return packages.get(packageName);
          }
          if (
            packageName === "which" &&
            packageJsonPaths.includes("/store/cross-spawn/package.json")
          ) {
            return packages.get(packageName);
          }
          return undefined;
        },
      ),
      {
        "@malept/cross-spawn-promise": "2.0.0",
        "cross-spawn": "7.0.6",
        which: "2.0.2",
      },
    );
  });

  it("walks each installed copy when issuers resolve the same dependency name differently", () => {
    const packages = new Map([
      [
        "parent-a",
        {
          packageJsonPath: "/store/parent-a/package.json",
          manifest: {
            version: "1.0.0",
            dependencies: {
              debug: "^2.0.0",
            },
          },
        },
      ],
      [
        "parent-b",
        {
          packageJsonPath: "/store/parent-b/package.json",
          manifest: {
            version: "1.0.0",
            dependencies: {
              debug: "^4.0.0",
            },
          },
        },
      ],
      [
        "debug-a",
        {
          packageJsonPath: "/store/debug-a/package.json",
          manifest: {
            version: "2.6.9",
            dependencies: {
              "child-a": "^1.0.0",
            },
          },
        },
      ],
      [
        "debug-b",
        {
          packageJsonPath: "/store/debug-b/package.json",
          manifest: {
            version: "4.4.3",
            dependencies: {
              "child-b": "^1.0.0",
            },
          },
        },
      ],
      [
        "child-a",
        {
          packageJsonPath: "/store/child-a/package.json",
          manifest: {
            version: "1.0.0",
          },
        },
      ],
      [
        "child-b",
        {
          packageJsonPath: "/store/child-b/package.json",
          manifest: {
            version: "1.0.0",
          },
        },
      ],
    ]);

    assert.deepStrictEqual(
      resolveStagedDependencyClosure(
        {
          "parent-a": "1.0.0",
          "parent-b": "1.0.0",
        },
        ["/repo/apps/server/package.json"],
        (packageName, packageJsonPaths) => {
          if (packageName === "parent-a" || packageName === "parent-b") {
            return packages.get(packageName);
          }
          if (
            packageName === "debug" &&
            packageJsonPaths.includes("/store/parent-a/package.json")
          ) {
            return packages.get("debug-a");
          }
          if (
            packageName === "debug" &&
            packageJsonPaths.includes("/store/parent-b/package.json")
          ) {
            return packages.get("debug-b");
          }
          return packages.get(packageName);
        },
      ),
      {
        "child-a": "1.0.0",
        "child-b": "1.0.0",
        debug: "2.6.9",
        "parent-a": "1.0.0",
        "parent-b": "1.0.0",
      },
    );
  });

  it("realpaths fallback package manifests before walking pnpm child dependencies", () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-stage-deps-"));
    try {
      const appDir = NodePath.join(tempDir, "apps", "server");
      const appNodeModulesDir = NodePath.join(appDir, "node_modules");
      const parentStoreNodeModulesDir = NodePath.join(
        tempDir,
        "node_modules",
        ".pnpm",
        "@scope+parent@1.0.0",
        "node_modules",
      );
      const parentStoreDir = NodePath.join(parentStoreNodeModulesDir, "@scope", "parent");
      const childStoreDir = NodePath.join(
        tempDir,
        "node_modules",
        ".pnpm",
        "child@1.0.0",
        "node_modules",
        "child",
      );

      NodeFS.mkdirSync(NodePath.join(appNodeModulesDir, "@scope"), { recursive: true });
      NodeFS.mkdirSync(parentStoreDir, { recursive: true });
      NodeFS.mkdirSync(childStoreDir, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(appDir, "package.json"),
        JSON.stringify({ name: "server", version: "1.0.0" }),
      );
      NodeFS.writeFileSync(
        NodePath.join(parentStoreDir, "package.json"),
        JSON.stringify({
          name: "@scope/parent",
          version: "1.0.0",
          exports: {
            ".": "./index.js",
          },
          dependencies: {
            child: "^1.0.0",
          },
        }),
      );
      NodeFS.writeFileSync(
        NodePath.join(childStoreDir, "package.json"),
        JSON.stringify({ name: "child", version: "1.0.0" }),
      );
      NodeFS.symlinkSync(
        parentStoreDir,
        NodePath.join(appNodeModulesDir, "@scope", "parent"),
        "dir",
      );
      NodeFS.symlinkSync(childStoreDir, NodePath.join(parentStoreNodeModulesDir, "child"), "dir");

      assert.deepStrictEqual(
        resolveStagedDependencyClosure(
          {
            "@scope/parent": "1.0.0",
          },
          [NodePath.join(appDir, "package.json")],
        ),
        {
          "@scope/parent": "1.0.0",
          child: "1.0.0",
        },
      );
    } finally {
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("promotes known runtime dependencies for staged packages unresolved before install", () => {
    assert.deepStrictEqual(
      resolveKnownStagedRuntimeDependencies({
        "cross-spawn": "7.0.6",
      }),
      {
        isexe: "2.0.0",
        "path-key": "3.1.1",
        "shebang-command": "2.0.0",
        "shebang-regex": "3.0.0",
        which: "2.0.2",
      },
    );
    assert.deepStrictEqual(
      resolveKnownStagedRuntimeDependencies({
        "cross-spawn": "^7.0.1",
      }),
      {
        isexe: "2.0.0",
        "path-key": "3.1.1",
        "shebang-command": "2.0.0",
        "shebang-regex": "3.0.0",
        which: "2.0.2",
      },
    );
    assert.deepStrictEqual(resolveKnownStagedRuntimeDependencies({ effect: "4.0.0-beta.78" }), {});
    assert.deepStrictEqual(
      resolveKnownStagedRuntimeDependencies({
        "cross-spawn": "6.0.6",
      }),
      {},
    );
    assert.deepStrictEqual(
      resolveKnownStagedRuntimeDependencies({
        "cross-spawn": "7.0.6",
        which: "2.0.3",
      }),
      {
        isexe: "2.0.0",
        "path-key": "3.1.1",
        "shebang-command": "2.0.0",
        "shebang-regex": "3.0.0",
      },
    );
  });

  it("carries known runtime dependencies into desktop stage dependencies", () => {
    const packages = new Map([
      [
        "@opencode-ai/sdk",
        {
          packageJsonPath: "/store/opencode/package.json",
          manifest: {
            version: "1.15.13",
            dependencies: {
              "cross-spawn": "7.0.6",
            },
          },
        },
      ],
    ]);

    assert.deepStrictEqual(
      resolveDesktopStageDependencies({
        dependencies: {
          "@opencode-ai/sdk": "^1.3.15",
        },
        platform: "mac",
        arch: "arm64",
        packageJsonPaths: ["/repo/apps/server/package.json"],
        resolvePackage: (packageName) => packages.get(packageName),
      }),
      {
        "@opencode-ai/sdk": "^1.3.15",
        "cross-spawn": "7.0.6",
        isexe: "2.0.0",
        "path-key": "3.1.1",
        "shebang-command": "2.0.0",
        "shebang-regex": "3.0.0",
        which: "2.0.2",
      },
    );
  });

  it("promotes ffi-rs optional native packages after resolving staged dependencies", () => {
    const packages = new Map([
      [
        "@ff-labs/fff-node",
        {
          packageJsonPath: "/store/fff-node/package.json",
          manifest: {
            version: "0.9.4",
            dependencies: {
              "ffi-rs": "^1.0.0",
            },
          },
        },
      ],
      [
        "ffi-rs",
        {
          packageJsonPath: "/store/ffi-rs/package.json",
          manifest: {
            version: "1.3.2",
          },
        },
      ],
    ]);

    assert.deepStrictEqual(
      resolveDesktopStageDependencies({
        dependencies: {
          "@ff-labs/fff-node": "0.9.4",
        },
        platform: "mac",
        arch: "arm64",
        packageJsonPaths: ["/repo/apps/server/package.json"],
        resolvePackage: (packageName) => packages.get(packageName),
      }),
      {
        "@ff-labs/fff-node": "0.9.4",
        "@yuuang/ffi-rs-darwin-arm64": "1.3.2",
        "ffi-rs": "1.3.2",
      },
    );

    assert.deepStrictEqual(
      resolveDesktopStageDependencies({
        dependencies: {
          "@ff-labs/fff-node": "0.9.4",
        },
        platform: "win",
        arch: "x64",
        packageJsonPaths: ["/repo/apps/server/package.json"],
        resolvePackage: (packageName) => packages.get(packageName),
      }),
      {
        "@ff-labs/fff-node": "0.9.4",
        "@yuuang/ffi-rs-linux-x64-gnu": "1.3.2",
        "@yuuang/ffi-rs-win32-x64-msvc": "1.3.2",
        "ffi-rs": "1.3.2",
      },
    );
  });

  it("carries only staged dependency patch metadata into staged desktop installs", () => {
    assert.deepStrictEqual(
      createStagePnpmConfig(
        {
          "@expo/metro-config@56.0.13": "patches/@expo%2Fmetro-config@56.0.13.patch",
          "@ff-labs/fff-node@0.9.4": "patches/@ff-labs__fff-node@0.9.4.patch",
          "@pierre/diffs@1.1.20": "patches/@pierre%2Fdiffs@1.1.20.patch",
          "alchemy@2.0.0-beta.49": "patches/alchemy@2.0.0-beta.49.patch",
          "effect@4.0.0-beta.73": "patches/effect@4.0.0-beta.73.patch",
        },
        {
          "@ff-labs/fff-node": "0.9.4",
          "@pierre/diffs": "1.1.20",
          effect: "4.0.0-beta.73",
        },
      ),
      {
        patchedDependencies: {
          "@ff-labs/fff-node@0.9.4": "patches/@ff-labs__fff-node@0.9.4.patch",
          "@pierre/diffs@1.1.20": "patches/@pierre%2Fdiffs@1.1.20.patch",
          "effect@4.0.0-beta.73": "patches/effect@4.0.0-beta.73.patch",
        },
      },
    );

    assert.equal(
      createStagePnpmConfig(
        {
          "@expo/metro-config@56.0.13": "patches/@expo%2Fmetro-config@56.0.13.patch",
        },
        { effect: "4.0.0-beta.73" },
      ),
      undefined,
    );
  });

  it("installs optional native dependencies for the target desktop architecture", () => {
    assert.deepStrictEqual(STAGE_INSTALL_ARGS, ["install", "--prod"]);
    assert.deepStrictEqual(createStageWorkspaceConfig("mac", "x64"), {
      supportedArchitectures: {
        os: ["darwin"],
        cpu: ["x64"],
      },
    });
    // Windows artifacts also bundle the same-architecture WSL (Linux, glibc) backend, so the
    // staged install must fetch its native optional deps (e.g. ffi-rs) too.
    assert.deepStrictEqual(createStageWorkspaceConfig("win", "x64"), {
      supportedArchitectures: {
        os: ["win32", "linux"],
        cpu: ["x64"],
        libc: ["glibc"],
      },
    });
    assert.deepStrictEqual(createStageWorkspaceConfig("win", "arm64"), {
      supportedArchitectures: {
        os: ["win32", "linux"],
        cpu: ["arm64"],
        libc: ["glibc"],
      },
    });
    assert.deepStrictEqual(createStageWorkspaceConfig("mac", "universal"), {
      supportedArchitectures: {
        os: ["darwin"],
        cpu: ["arm64", "x64"],
      },
    });
  });

  it("unpacks the fff shared library for filesystem and FFI access", () => {
    assert.deepStrictEqual(DESKTOP_ASAR_UNPACK, [
      "node_modules/@ff-labs/fff-bin-*/**/*",
      "node_modules/@yuuang/ffi-rs-*/**/*",
    ]);
  });

  it.effect("preserves both Linux icon resize failures with structural context", () => {
    const commands: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = [];

    return Effect.gen(function* () {
      const error = yield* stageLinuxIconSize("source.png", "target.png", 512, false).pipe(
        Effect.provide(iconResizeSpawnerLayer(commands, [1, 2])),
        Effect.flip,
      );

      assert.instanceOf(error, LinuxIconResizeError);
      assert.equal(error.operation, "resize");
      assert.equal(error.iconSize, 512);
      assert.equal(error.primaryTool, "magick");
      assert.equal(error.fallbackTool, "convert");
      assert.include(error.message, "512x512");
      assert.include(error.message, "`magick`");
      assert.include(error.message, "`convert`");
      assert.notInclude(error.message, "non-zero exit code");

      assert.instanceOf(error.cause, AggregateError);
      const aggregateCause = error.cause as AggregateError;
      assert.lengthOf(aggregateCause.errors, 2);
      assert.strictEqual(aggregateCause.cause, aggregateCause.errors[0]);
      assert.instanceOf(aggregateCause.errors[0], BuildCommandFailedError);
      assert.instanceOf(aggregateCause.errors[1], BuildCommandFailedError);
      const primaryError = aggregateCause.errors[0] as BuildCommandFailedError;
      const fallbackError = aggregateCause.errors[1] as BuildCommandFailedError;
      assert.equal(primaryError.command, "magick linux icon 512x512");
      assert.equal(primaryError.exitCode, 1);
      assert.include(primaryError.message, "magick linux icon");
      assert.equal(fallbackError.command, "convert linux icon 512x512");
      assert.equal(fallbackError.exitCode, 2);
      assert.include(fallbackError.message, "convert linux icon");
      assert.deepStrictEqual(
        commands.map(({ command }) => command),
        ["magick", "convert"],
      );
    });
  });

  it("derives macOS passkey signing configuration from the Clerk publishable key", () => {
    const configuration = resolveMacPasskeySigningConfiguration({
      T3CODE_APPLE_TEAM_ID: "abc1234567",
      T3CODE_MACOS_PROVISIONING_PROFILE: "/tmp/t3code.provisionprofile",
      T3CODE_CLERK_PUBLISHABLE_KEY: `pk_test_${btoa("example.clerk.accounts.dev$")}`,
    });

    assert.deepStrictEqual(configuration, {
      appId: "com.t3tools.t3code",
      teamId: "ABC1234567",
      rpDomains: ["example.clerk.accounts.dev"],
      provisioningProfilePath: "/tmp/t3code.provisionprofile",
    });
  });

  it("normalizes explicit macOS passkey RP domains and renders required entitlements", () => {
    const configuration = resolveMacPasskeySigningConfiguration({
      T3CODE_APPLE_TEAM_ID: "ABC1234567",
      T3CODE_MACOS_PROVISIONING_PROFILE: "/tmp/t3code.provisionprofile",
      T3CODE_CLERK_PASSKEY_RP_DOMAINS:
        " Clerk.Example.com,example.clerk.accounts.dev,clerk.example.com ",
    });
    const entitlements = renderMacPasskeyEntitlements(configuration);

    assert.deepStrictEqual(configuration.rpDomains, [
      "clerk.example.com",
      "example.clerk.accounts.dev",
    ]);
    assert.include(entitlements, "<string>ABC1234567.com.t3tools.t3code</string>");
    assert.include(entitlements, "<string>webcredentials:clerk.example.com</string>");
    assert.include(entitlements, "<string>webcredentials:example.clerk.accounts.dev</string>");
    assert.include(entitlements, "<key>com.apple.security.cs.allow-jit</key>");
  });

  it("rejects incomplete macOS passkey signing configuration", () => {
    const captureError = (env: Readonly<Record<string, string | undefined>>) => {
      try {
        resolveMacPasskeySigningConfiguration(env);
      } catch (error) {
        return error;
      }
      return assert.fail("Expected passkey signing configuration to fail.");
    };

    const missingProfileError = captureError({
      T3CODE_APPLE_TEAM_ID: "ABC1234567",
      T3CODE_CLERK_PASSKEY_RP_DOMAINS: "example.clerk.accounts.dev",
    });
    assert.instanceOf(missingProfileError, MissingMacPasskeyProvisioningProfileError);
    assert.equal(
      missingProfileError.message,
      "T3CODE_MACOS_PROVISIONING_PROFILE must point to an Associated Domains provisioning profile.",
    );

    const unsafeDomain =
      "https://domain-user:domain-secret@example.clerk.accounts.dev/path?token=query-secret";
    const invalidDomainError = captureError({
      T3CODE_APPLE_TEAM_ID: "ABC1234567",
      T3CODE_MACOS_PROVISIONING_PROFILE: "/tmp/t3code.provisionprofile",
      T3CODE_CLERK_PASSKEY_RP_DOMAINS: unsafeDomain,
    });
    assert.instanceOf(invalidDomainError, InvalidMacPasskeyRpDomainError);
    assert.equal(invalidDomainError.reason, "scheme-not-allowed");
    assert.equal(invalidDomainError.inputLength, unsafeDomain.length);
    assert.equal(invalidDomainError.message, "Invalid passkey RP domain (scheme-not-allowed).");
    assert.notProperty(invalidDomainError, "domain");
    assert.notProperty(invalidDomainError, "cause");
    const serializedInvalidDomainError = JSON.stringify(invalidDomainError);
    assert.notInclude(serializedInvalidDomainError, unsafeDomain);
    assert.notInclude(serializedInvalidDomainError, "domain-user");
    assert.notInclude(serializedInvalidDomainError, "domain-secret");
    assert.notInclude(serializedInvalidDomainError, "query-secret");
    assert.throws(
      () =>
        resolveMacPasskeySigningConfiguration({
          T3CODE_APPLE_TEAM_ID: "ABC1234567",
          T3CODE_MACOS_PROVISIONING_PROFILE: "/tmp/t3code.provisionprofile",
          T3CODE_CLERK_PASSKEY_RP_DOMAINS: "example.clerk.accounts.dev:8443",
        }),
      /Invalid passkey RP domain/u,
    );
    const invalidPublishableKeyError = captureError({
      T3CODE_APPLE_TEAM_ID: "ABC1234567",
      T3CODE_MACOS_PROVISIONING_PROFILE: "/tmp/t3code.provisionprofile",
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_%",
    });
    assert.instanceOf(invalidPublishableKeyError, InvalidMacPasskeyPublishableKeyError);
    assert.ok(invalidPublishableKeyError.cause);
    assert.equal(invalidPublishableKeyError.message, "T3CODE_CLERK_PUBLISHABLE_KEY is invalid.");
    assert.notProperty(invalidPublishableKeyError, "publishableKey");
    assert.notInclude(invalidPublishableKeyError.message, "pk_test_%");
  });

  it("preserves known passkey signing configuration errors at the build boundary", () => {
    const decodingCause = new Error("publishable-key-decode-failed");
    const knownError = new InvalidMacPasskeyPublishableKeyError({ cause: decodingCause });
    const error = MacPasskeySigningConfigurationResolutionError.fromCause(knownError);

    assert.strictEqual(error, knownError);
    assert.instanceOf(error, InvalidMacPasskeyPublishableKeyError);
    assert.strictEqual(error.cause, decodingCause);
    assert.isTrue(isMacPasskeySigningConfigurationError(error));
  });

  it("wraps unknown passkey signing configuration defects without copying cause text", () => {
    const secret = "pk_test_do-not-retain";
    const cause = new Error(secret);
    const error = MacPasskeySigningConfigurationResolutionError.fromCause(cause);

    assert.instanceOf(error, MacPasskeySigningConfigurationResolutionError);
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message, "Failed to resolve macOS passkey signing configuration.");
    assert.notInclude(error.message, secret);
  });

  it.effect("adds passkey entitlements and both renderer protocols to signed macOS builds", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig("mac", "dmg", "1.2.3", true, false, undefined, {
        entitlementsPath: "/tmp/entitlements.mac.plist",
        provisioningProfilePath: "/tmp/t3code.provisionprofile",
      });

      const mac = config.mac as Record<string, unknown>;
      assert.equal(config.appId, "com.t3tools.t3code");
      assert.equal(mac.entitlements, "/tmp/entitlements.mac.plist");
      assert.equal(mac.provisioningProfile, "/tmp/t3code.provisionprofile");
      assert.deepStrictEqual(mac.protocols, [
        { name: "T3 Code", schemes: ["t3code", "t3code-dev"] },
      ]);
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))),
  );

  it.effect("keeps executable resource editing enabled for unsigned Windows builds", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig(
        "win",
        "nsis",
        "1.2.3",
        false,
        false,
        undefined,
        undefined,
      );

      const win = config.win as Record<string, unknown>;
      assert.equal(win.icon, "icon.ico");
      assert.equal(win.signAndEditExecutable, true);
      assert.notProperty(win, "azureSignOptions");
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))),
  );

  it("promotes target fff binaries to direct staged dependencies", () => {
    assert.deepStrictEqual(resolveFffNativeDependencies("mac", "arm64", "0.9.4"), {
      "@ff-labs/fff-bin-darwin-arm64": "0.9.4",
    });
    assert.deepStrictEqual(resolveFffNativeDependencies("mac", "universal", "0.9.4"), {
      "@ff-labs/fff-bin-darwin-arm64": "0.9.4",
      "@ff-labs/fff-bin-darwin-x64": "0.9.4",
    });
    assert.deepStrictEqual(resolveFffNativeDependencies("win", "x64", "0.9.4"), {
      "@ff-labs/fff-bin-win32-x64": "0.9.4",
    });
    assert.deepStrictEqual(resolveFffNativeDependencies("linux", "x64", "0.9.4"), {
      "@ff-labs/fff-bin-linux-x64-gnu": "0.9.4",
      "@ff-labs/fff-bin-linux-x64-musl": "0.9.4",
    });
    assert.deepStrictEqual(resolveFffNativeDependencies("linux", "arm64", "0.9.4"), {
      "@ff-labs/fff-bin-linux-arm64-gnu": "0.9.4",
      "@ff-labs/fff-bin-linux-arm64-musl": "0.9.4",
    });
  });

  it("promotes target ffi-rs binaries to direct staged dependencies", () => {
    assert.deepStrictEqual(resolveFfiRsNativeDependencies("mac", "arm64", "1.3.2"), {
      "@yuuang/ffi-rs-darwin-arm64": "1.3.2",
    });
    assert.deepStrictEqual(resolveFfiRsNativeDependencies("mac", "universal", "1.3.2"), {
      "@yuuang/ffi-rs-darwin-arm64": "1.3.2",
      "@yuuang/ffi-rs-darwin-x64": "1.3.2",
    });
    assert.deepStrictEqual(resolveFfiRsNativeDependencies("win", "x64", "1.3.2"), {
      "@yuuang/ffi-rs-win32-x64-msvc": "1.3.2",
    });
    assert.deepStrictEqual(resolveFfiRsNativeDependencies("win", "arm64", "1.3.2"), {
      "@yuuang/ffi-rs-win32-arm64-msvc": "1.3.2",
    });
    assert.deepStrictEqual(resolveFfiRsNativeDependencies("linux", "x64", "1.3.2"), {
      "@yuuang/ffi-rs-linux-x64-gnu": "1.3.2",
      "@yuuang/ffi-rs-linux-x64-musl": "1.3.2",
    });
    assert.deepStrictEqual(resolveFfiRsNativeDependencies("linux", "arm64", "1.3.2"), {
      "@yuuang/ffi-rs-linux-arm64-gnu": "1.3.2",
      "@yuuang/ffi-rs-linux-arm64-musl": "1.3.2",
    });
  });

  it("resolves target Clerk passkey native artifacts", () => {
    assert.deepStrictEqual(resolveClerkPasskeyNativeArtifacts("mac", "universal"), [
      {
        packageName: "@clerk/electron-passkeys-darwin-arm64",
        binaryFileName: "electron-passkeys.darwin-arm64.node",
      },
      {
        packageName: "@clerk/electron-passkeys-darwin-x64",
        binaryFileName: "electron-passkeys.darwin-x64.node",
      },
    ]);
    assert.deepStrictEqual(resolveClerkPasskeyNativeArtifacts("win", "x64"), [
      {
        packageName: "@clerk/electron-passkeys-win32-x64-msvc",
        binaryFileName: "electron-passkeys.win32-x64-msvc.node",
      },
    ]);
    assert.deepStrictEqual(resolveClerkPasskeyNativeArtifacts("linux", "x64"), []);
  });

  it("falls back to the default mock update port when the configured port is blank", () => {
    assert.equal(resolveMockUpdateServerUrl(undefined), "http://localhost:3000");
    assert.equal(resolveMockUpdateServerUrl(4123), "http://localhost:4123");
  });

  it.effect("normalizes mock update server ports from env-style strings", () =>
    Effect.gen(function* () {
      assert.equal(yield* resolveMockUpdateServerPort(undefined), undefined);
      assert.equal(yield* resolveMockUpdateServerPort(""), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("   "), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("4123"), 4123);
    }),
  );

  it.effect("rejects non-numeric or out-of-range mock update ports", () =>
    Effect.gen(function* () {
      const invalidPorts = ["abc", "12.5", "0", "65536"];
      for (const port of invalidPorts) {
        const exit = yield* Effect.exit(resolveMockUpdateServerPort(port));
        assert.equal(exit._tag, "Failure");
      }
    }),
  );

  it("classifies invalid configured ports with the decoder's number grammar", () => {
    const cause = new Error("invalid configured port");

    assert.equal(
      InvalidMockUpdateServerPortError.fromConfigValue("0x10", cause).reason,
      "not-numeric",
    );
    assert.equal(
      InvalidMockUpdateServerPortError.fromConfigValue("12.5", cause).reason,
      "not-integer",
    );
    assert.equal(
      InvalidMockUpdateServerPortError.fromConfigValue("65536", cause).reason,
      "out-of-range",
    );
    assert.strictEqual(
      InvalidMockUpdateServerPortError.fromConfigValue("0x10", cause).cause,
      cause,
    );
  });

  it.effect("resolves default platform and architecture from host references", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveBuildOptions({
        platform: Option.none(),
        target: Option.none(),
        arch: Option.none(),
        buildVersion: Option.none(),
        outputDir: Option.none(),
        skipBuild: Option.none(),
        keepStage: Option.none(),
        signed: Option.none(),
        verbose: Option.none(),
        mockUpdates: Option.none(),
        mockUpdateServerPort: Option.none(),
        wslPrebuild: Option.none(),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcessPlatform, "win32"),
            Layer.succeed(HostProcessArchitecture, "x64"),
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  PROCESSOR_ARCHITECTURE: "AMD64",
                  PROCESSOR_ARCHITEW6432: "ARM64",
                },
              }),
            ),
          ),
        ),
      );

      assert.equal(resolved.platform, "win");
      assert.equal(resolved.target, "nsis");
      assert.equal(resolved.arch, "arm64");
    }),
  );

  it.effect("preserves explicit false boolean flags over true env defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveBuildOptions({
        platform: Option.some("mac"),
        target: Option.none(),
        arch: Option.some("arm64"),
        buildVersion: Option.none(),
        outputDir: Option.some("release-test"),
        skipBuild: Option.some(false),
        keepStage: Option.some(false),
        signed: Option.some(false),
        verbose: Option.some(false),
        mockUpdates: Option.some(false),
        mockUpdateServerPort: Option.none(),
        wslPrebuild: Option.none(),
      }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                T3CODE_DESKTOP_SKIP_BUILD: "true",
                T3CODE_DESKTOP_KEEP_STAGE: "true",
                T3CODE_DESKTOP_SIGNED: "true",
                T3CODE_DESKTOP_VERBOSE: "true",
                T3CODE_DESKTOP_MOCK_UPDATES: "true",
              },
            }),
          ),
        ),
      );

      assert.equal(resolved.skipBuild, false);
      assert.equal(resolved.keepStage, false);
      assert.equal(resolved.signed, false);
      assert.equal(resolved.verbose, false);
      assert.equal(resolved.mockUpdates, false);
    }),
  );
});
