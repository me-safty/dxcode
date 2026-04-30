import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderDriverKind } from "@t3tools/contracts";
import {
  createProviderVersionAdvisory,
  getProviderVersionLifecycle,
} from "./providerVersionLifecycle.ts";

const driver = (value: string) => ProviderDriverKind.make(value);

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
    expect(getProviderVersionLifecycle(driver("cursor"))).toEqual({
      provider: driver("cursor"),
      packageName: null,
      updateCommand: "agent update",
      updateExecutable: "agent",
      updateArgs: ["update"],
      updateLockKey: "cursor-agent",
    });
  });

  it("switches package-managed providers to bun updates when the resolved binary lives in bun's global bin", () => {
    const tempDir = path.join(os.tmpdir(), `t3-bun-lifecycle-${Date.now()}`);
    const bunBinDir = path.join(tempDir, ".bun", "bin");
    mkdirSync(bunBinDir, { recursive: true });
    writeFileSync(path.join(bunBinDir, "claude.exe"), "MZ");

    expect(
      getProviderVersionLifecycle(driver("claudeAgent"), {
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
      updateCommand: "bun add -g @anthropic-ai/claude-code@latest",
      updateExecutable: "bun",
      updateArgs: ["add", "-g", "@anthropic-ai/claude-code@latest"],
      updateLockKey: "bun-global",
    });
  });

  it("disables one-click updates for explicit custom binary paths it cannot safely map", () => {
    expect(
      getProviderVersionLifecycle(driver("codex"), {
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
