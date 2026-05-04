import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import os from "node:os";
import path from "node:path";
import { ProviderDriverKind } from "@t3tools/contracts";
import { Effect } from "effect";
import {
  createProviderVersionAdvisory,
  isClaudeNativeCommandPath,
  isOpenCodeNativeCommandPath,
  makePackageManagedProviderVersionLifecycleResolver,
  makeProviderVersionLifecycle,
  makeStaticProviderVersionLifecycleResolver,
  resolveProviderVersionLifecycleEffect,
} from "./providerVersionLifecycle.ts";

const driver = (value: string) => ProviderDriverKind.make(value);
const codexUpdate = makePackageManagedProviderVersionLifecycleResolver({
  provider: driver("codex"),
  npmPackageName: "@openai/codex",
  homebrewFormula: "codex",
  nativeUpdate: null,
});
const claudeUpdate = makePackageManagedProviderVersionLifecycleResolver({
  provider: driver("claudeAgent"),
  npmPackageName: "@anthropic-ai/claude-code",
  homebrewFormula: "claude-code",
  nativeUpdate: {
    executable: "claude",
    args: ["update"],
    lockKey: "claude-native",
    isCommandPath: isClaudeNativeCommandPath,
  },
});
const opencodeUpdate = makePackageManagedProviderVersionLifecycleResolver({
  provider: driver("opencode"),
  npmPackageName: "opencode-ai",
  homebrewFormula: "anomalyco/tap/opencode",
  nativeUpdate: {
    executable: "opencode",
    args: ["upgrade"],
    lockKey: "opencode-native",
    isCommandPath: isOpenCodeNativeCommandPath,
  },
});
const cursorUpdate = makeStaticProviderVersionLifecycleResolver(
  makeProviderVersionLifecycle({
    provider: driver("cursor"),
    packageName: null,
    updateExecutable: "agent",
    updateArgs: ["update"],
    updateLockKey: "cursor-agent",
  }),
);

describe("providerVersionLifecycle", () => {
  it("marks providers with unknown current versions as unknown", () => {
    expect(
      createProviderVersionAdvisory({
        driver: driver("codex"),
        currentVersion: null,
        latestVersion: "9.9.9",
      }),
    ).toMatchObject({
      status: "unknown",
      currentVersion: null,
      latestVersion: "9.9.9",
    });
  });

  it("marks providers with unknown latest versions as unknown", () => {
    expect(
      createProviderVersionAdvisory({
        driver: driver("codex"),
        currentVersion: "1.0.0",
        latestVersion: null,
      }),
    ).toMatchObject({
      status: "unknown",
      currentVersion: "1.0.0",
      latestVersion: null,
      message: null,
    });
  });

  it("marks installed providers behind latest when a newer provider version is available", () => {
    expect(
      createProviderVersionAdvisory({
        driver: driver("claudeAgent"),
        currentVersion: "2.1.110",
        latestVersion: "2.1.117",
        versionLifecycle: claudeUpdate.resolve(),
      }),
    ).toMatchObject({
      status: "behind_latest",
      currentVersion: "2.1.110",
      latestVersion: "2.1.117",
      updateCommand: "npm install -g @anthropic-ai/claude-code@latest",
      canUpdate: true,
      message: "Install the update now or review provider settings.",
    });
  });

  it("keeps update commands owned by provider lifecycle metadata", () => {
    expect(cursorUpdate.resolve()).toEqual({
      provider: driver("cursor"),
      packageName: null,
      updateCommand: "agent update",
      updateExecutable: "agent",
      updateArgs: ["update"],
      updateLockKey: "cursor-agent",
    });
  });

  it("switches package-managed providers to vite-plus updates when the resolved binary lives in vite-plus global bin", () => {
    const tempDir = path.join(os.tmpdir(), `t3-vite-plus-lifecycle-${Date.now()}`);
    const vitePlusBinDir = path.join(tempDir, ".vite-plus", "bin");
    mkdirSync(vitePlusBinDir, { recursive: true });
    const codexPath = path.join(vitePlusBinDir, "codex");
    writeFileSync(codexPath, "#!/bin/sh\n");
    chmodSync(codexPath, 0o755);

    expect(
      codexUpdate.resolve({
        binaryPath: "codex",
        platform: "darwin",
        env: {
          PATH: vitePlusBinDir,
        },
      }),
    ).toEqual({
      provider: driver("codex"),
      packageName: "@openai/codex",
      updateCommand: "vp i -g @openai/codex",
      updateExecutable: "vp",
      updateArgs: ["i", "-g", "@openai/codex"],
      updateLockKey: "vite-plus-global",
    });
  });

  it("switches package-managed providers to bun updates when the resolved binary lives in bun's global bin", () => {
    const tempDir = path.join(os.tmpdir(), `t3-bun-lifecycle-${Date.now()}`);
    const bunBinDir = path.join(tempDir, ".bun", "bin");
    mkdirSync(bunBinDir, { recursive: true });
    writeFileSync(path.join(bunBinDir, "claude.exe"), "MZ");

    expect(
      claudeUpdate.resolve({
        binaryPath: "claude",
        platform: "win32",
        env: {
          PATH: bunBinDir,
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
        },
      }),
    ).toEqual({
      provider: driver("claudeAgent"),
      packageName: "@anthropic-ai/claude-code",
      updateCommand: "bun i -g @anthropic-ai/claude-code@latest",
      updateExecutable: "bun",
      updateArgs: ["i", "-g", "@anthropic-ai/claude-code@latest"],
      updateLockKey: "bun-global",
    });
  });

  it("switches package-managed providers to pnpm updates when the resolved binary lives in pnpm's global bin", () => {
    const tempDir = path.join(os.tmpdir(), `t3-pnpm-lifecycle-${Date.now()}`);
    const pnpmHomeDir = path.join(tempDir, ".local", "share", "pnpm");
    mkdirSync(pnpmHomeDir, { recursive: true });
    const opencodePath = path.join(pnpmHomeDir, "opencode");
    writeFileSync(opencodePath, "#!/bin/sh\n");
    chmodSync(opencodePath, 0o755);

    expect(
      opencodeUpdate.resolve({
        binaryPath: "opencode",
        platform: "darwin",
        env: {
          PATH: pnpmHomeDir,
        },
      }),
    ).toEqual({
      provider: driver("opencode"),
      packageName: "opencode-ai",
      updateCommand: "pnpm add -g opencode-ai@latest",
      updateExecutable: "pnpm",
      updateArgs: ["add", "-g", "opencode-ai@latest"],
      updateLockKey: "pnpm-global",
    });
  });

  it("switches codex to Homebrew updates when the binary resolves through Homebrew", () => {
    expect(
      codexUpdate.resolve({
        binaryPath: "/opt/homebrew/bin/codex",
        platform: "darwin",
        env: {
          PATH: "",
        },
      }),
    ).toEqual({
      provider: driver("codex"),
      packageName: "@openai/codex",
      updateCommand: "brew upgrade codex",
      updateExecutable: "brew",
      updateArgs: ["upgrade", "codex"],
      updateLockKey: "homebrew",
    });
  });

  it("switches claude to native updates when the binary resolves through the native installer", () => {
    const tempDir = path.join(os.tmpdir(), `t3-claude-native-lifecycle-${Date.now()}`);
    const nativeBinDir = path.join(tempDir, ".local", "bin");
    mkdirSync(nativeBinDir, { recursive: true });
    const claudePath = path.join(nativeBinDir, "claude");
    writeFileSync(claudePath, "#!/bin/sh\n");
    chmodSync(claudePath, 0o755);

    expect(
      claudeUpdate.resolve({
        binaryPath: "claude",
        platform: "darwin",
        env: {
          PATH: nativeBinDir,
        },
      }),
    ).toEqual({
      provider: driver("claudeAgent"),
      packageName: "@anthropic-ai/claude-code",
      updateCommand: "claude update",
      updateExecutable: "claude",
      updateArgs: ["update"],
      updateLockKey: "claude-native",
    });
  });

  it("switches opencode to native upgrades when the binary resolves through the standalone installer", () => {
    const tempDir = path.join(os.tmpdir(), `t3-opencode-native-lifecycle-${Date.now()}`);
    const nativeBinDir = path.join(tempDir, ".opencode", "bin");
    mkdirSync(nativeBinDir, { recursive: true });
    const opencodePath = path.join(nativeBinDir, "opencode");
    writeFileSync(opencodePath, "#!/bin/sh\n");
    chmodSync(opencodePath, 0o755);

    expect(
      opencodeUpdate.resolve({
        binaryPath: "opencode",
        platform: "darwin",
        env: {
          PATH: nativeBinDir,
        },
      }),
    ).toEqual({
      provider: driver("opencode"),
      packageName: "opencode-ai",
      updateCommand: "opencode upgrade",
      updateExecutable: "opencode",
      updateArgs: ["upgrade"],
      updateLockKey: "opencode-native",
    });
  });

  it("switches claude to Homebrew updates when the binary resolves through Homebrew", () => {
    expect(
      claudeUpdate.resolve({
        binaryPath: "/opt/homebrew/bin/claude",
        platform: "darwin",
        env: {
          PATH: "",
        },
      }),
    ).toEqual({
      provider: driver("claudeAgent"),
      packageName: "@anthropic-ai/claude-code",
      updateCommand: "brew upgrade claude-code",
      updateExecutable: "brew",
      updateArgs: ["upgrade", "claude-code"],
      updateLockKey: "homebrew",
    });
  });

  it("switches opencode to Homebrew updates when the binary resolves through Homebrew", () => {
    expect(
      opencodeUpdate.resolve({
        binaryPath: "/opt/homebrew/bin/opencode",
        platform: "darwin",
        env: {
          PATH: "",
        },
      }),
    ).toEqual({
      provider: driver("opencode"),
      packageName: "opencode-ai",
      updateCommand: "brew upgrade anomalyco/tap/opencode",
      updateExecutable: "brew",
      updateArgs: ["upgrade", "anomalyco/tap/opencode"],
      updateLockKey: "homebrew",
    });
  });

  it("keeps npm updates for binaries symlinked into npm's global node_modules tree", async () => {
    const tempDir = path.join(os.tmpdir(), `t3-npm-lifecycle-${Date.now()}`);
    const binDir = path.join(tempDir, "bin");
    const packageBinDir = path.join(tempDir, "lib", "node_modules", "@openai", "codex", "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(packageBinDir, { recursive: true });
    const packageBinPath = path.join(packageBinDir, "codex.js");
    const symlinkPath = path.join(binDir, "codex");
    writeFileSync(packageBinPath, "#!/usr/bin/env node\n");
    chmodSync(packageBinPath, 0o755);
    symlinkSync(packageBinPath, symlinkPath);

    await expect(
      Effect.runPromise(
        resolveProviderVersionLifecycleEffect(codexUpdate, {
          binaryPath: symlinkPath,
          platform: "darwin",
          env: {
            PATH: "",
          },
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).resolves.toEqual({
      provider: driver("codex"),
      packageName: "@openai/codex",
      updateCommand: "npm install -g @openai/codex@latest",
      updateExecutable: "npm",
      updateArgs: ["install", "-g", "@openai/codex@latest"],
      updateLockKey: "npm-global",
    });
  });

  it("uses Effect FileSystem realPath when detecting pnpm global symlinks", async () => {
    const tempDir = path.join(os.tmpdir(), `t3-pnpm-realpath-lifecycle-${Date.now()}`);
    const binDir = path.join(tempDir, "bin");
    const packageBinDir = path.join(
      tempDir,
      ".local",
      "share",
      "pnpm",
      "global",
      "5",
      "node_modules",
      "@openai",
      "codex",
      "bin",
    );
    mkdirSync(binDir, { recursive: true });
    mkdirSync(packageBinDir, { recursive: true });
    const packageBinPath = path.join(packageBinDir, "codex.js");
    const symlinkPath = path.join(binDir, "codex");
    writeFileSync(packageBinPath, "#!/usr/bin/env node\n");
    chmodSync(packageBinPath, 0o755);
    symlinkSync(packageBinPath, symlinkPath);

    await expect(
      Effect.runPromise(
        resolveProviderVersionLifecycleEffect(codexUpdate, {
          binaryPath: symlinkPath,
          platform: "darwin",
          env: {
            PATH: "",
          },
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).resolves.toEqual({
      provider: driver("codex"),
      packageName: "@openai/codex",
      updateCommand: "pnpm add -g @openai/codex@latest",
      updateExecutable: "pnpm",
      updateArgs: ["add", "-g", "@openai/codex@latest"],
      updateLockKey: "pnpm-global",
    });
  });

  it("disables one-click updates for explicit custom binary paths it cannot safely map", () => {
    expect(
      codexUpdate.resolve({
        binaryPath: "C:\\Tools\\codex\\codex.exe",
        platform: "win32",
        env: {
          PATH: "",
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
        },
      }),
    ).toEqual({
      provider: driver("codex"),
      packageName: "@openai/codex",
      updateCommand: null,
      updateExecutable: null,
      updateArgs: [],
      updateLockKey: null,
    });
  });
});
