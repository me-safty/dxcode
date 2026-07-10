import { describe, expect, it } from "@effect/vitest";

import {
  deriveCodexStandaloneUpdateEnvironment,
  isCodexStandaloneCommandPath,
  resolveCodexProviderMaintenanceCapabilities,
} from "./CodexDriver.ts";

describe("isCodexStandaloneCommandPath", () => {
  it("matches current-symlink standalone layouts", () => {
    expect(
      isCodexStandaloneCommandPath("/home/u/.codex/packages/standalone/current/bin/codex"),
    ).toBe(true);
    expect(isCodexStandaloneCommandPath("/home/u/.codex/packages/standalone/current/codex")).toBe(
      true,
    );
  });

  it("matches the versioned release binary the current symlink resolves to", () => {
    expect(
      isCodexStandaloneCommandPath(
        "/home/u/.codex/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl/codex",
      ),
    ).toBe(true);
    expect(
      isCodexStandaloneCommandPath(
        "C:\\Users\\u\\.codex\\packages\\standalone\\releases\\0.111.0-x86_64-pc-windows-msvc\\codex.EXE",
      ),
    ).toBe(true);
  });

  it("rejects paths outside a standalone install", () => {
    expect(isCodexStandaloneCommandPath("/home/u/.local/bin/codex")).toBe(false);
    expect(isCodexStandaloneCommandPath("/usr/lib/node_modules/@openai/codex/bin/codex.js")).toBe(
      false,
    );
    expect(
      isCodexStandaloneCommandPath("/home/u/monorepo/packages/standalone/node_modules/.bin/codex"),
    ).toBe(false);
    expect(
      isCodexStandaloneCommandPath(
        "/home/u/.codex/packages/standalone/releases/0.111.0/notes/codex.txt",
      ),
    ).toBe(false);
  });
});

describe("deriveCodexStandaloneUpdateEnvironment", () => {
  it("pins CODEX_HOME to the install root of the matched binary", () => {
    expect(
      deriveCodexStandaloneUpdateEnvironment(
        "/home/julius/codex-home/packages/standalone/current/codex",
      ),
    ).toEqual({ CODEX_HOME: "/home/julius/codex-home" });
    expect(
      deriveCodexStandaloneUpdateEnvironment(
        "/home/u/.codex/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl/codex",
      ),
    ).toEqual({ CODEX_HOME: "/home/u/.codex" });
    expect(
      deriveCodexStandaloneUpdateEnvironment(
        "C:\\Users\\u\\.codex\\packages\\standalone\\releases\\1.0.0\\codex.exe",
      ),
    ).toEqual({ CODEX_HOME: "C:\\Users\\u\\.codex" });
  });

  it("returns null when no install root precedes the standalone segment", () => {
    expect(deriveCodexStandaloneUpdateEnvironment("/packages/standalone/current/codex")).toBeNull();
  });
});

describe("resolveCodexProviderMaintenanceCapabilities", () => {
  it.each([
    {
      label: "bare command",
      binaryPath: "codex",
      resolvedCommandPath: "/home/u/.local/bin/codex",
      expectedExecutable: "/home/u/.local/bin/codex",
    },
    {
      label: "current alias",
      binaryPath: "/home/u/.codex/packages/standalone/current/codex",
      resolvedCommandPath: "/home/u/.codex/packages/standalone/current/codex",
      expectedExecutable: "/home/u/.codex/packages/standalone/current/codex",
    },
    {
      label: "visible alias",
      binaryPath: "/usr/local/bin/codex",
      resolvedCommandPath: "/usr/local/bin/codex",
      expectedExecutable: "/usr/local/bin/codex",
    },
  ])("allows native updates for a $label with a versioned release realpath", (testCase) => {
    expect(
      resolveCodexProviderMaintenanceCapabilities({
        binaryPath: testCase.binaryPath,
        platform: "linux",
        resolvedCommandPath: testCase.resolvedCommandPath,
        realCommandPath:
          "/home/u/.codex/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl/codex",
      }),
    ).toEqual({
      provider: "codex",
      packageName: "@openai/codex",
      update: {
        command: `CODEX_HOME=/home/u/.codex ${testCase.expectedExecutable} update`,
        executable: testCase.expectedExecutable,
        args: ["update"],
        lockKey: "codex-native",
        env: { CODEX_HOME: "/home/u/.codex" },
      },
    });
  });

  it.each([
    "/home/u/.codex/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl/codex",
    "/home/u/.codex/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl/bin/codex",
  ])("disables one-click updates for an explicitly configured release path: %s", (binaryPath) => {
    expect(
      resolveCodexProviderMaintenanceCapabilities({
        binaryPath,
        resolvedCommandPath: binaryPath,
        realCommandPath: binaryPath,
      }),
    ).toEqual({
      provider: "codex",
      packageName: "@openai/codex",
      update: null,
    });
  });

  it("disables one-click updates when a bare command resolves directly to a release", () => {
    const releasePath =
      "/home/u/.codex/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl/codex";

    expect(
      resolveCodexProviderMaintenanceCapabilities({
        binaryPath: "codex",
        resolvedCommandPath: releasePath,
        realCommandPath: releasePath,
      }),
    ).toEqual({
      provider: "codex",
      packageName: "@openai/codex",
      update: null,
    });
  });
});
