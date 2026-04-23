import { describe, expect, it } from "vitest";
import type { ServerProvider } from "@t3tools/contracts";

import {
  createProviderVersionAdvisory,
  enrichProviderSnapshotWithVersionAdvisory,
  getProviderVersionLifecycle,
} from "./providerVersionLifecycle.ts";

describe("providerVersionLifecycle", () => {
  it("marks providers with unknown current versions as unknown", () => {
    expect(
      createProviderVersionAdvisory({
        driver: "codex",
        currentVersion: null,
        latestVersion: "9.9.9",
      }),
    ).toMatchObject({
      status: "unknown",
      currentVersion: null,
      latestVersion: "9.9.9",
    });
  });

  it("marks installed providers behind latest when a newer provider version is available", () => {
    expect(
      createProviderVersionAdvisory({
        driver: "claudeAgent",
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
    expect(getProviderVersionLifecycle("cursor")).toEqual({
      provider: "cursor",
      packageName: null,
      updateCommand: "agent update",
      updateExecutable: "agent",
      updateArgs: ["update"],
      updateLockKey: "cursor-agent",
    });
  });

  it("honors dev advisory overrides without querying the registry", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called when a dev advisory override is present");
    }) as unknown as typeof fetch;

    const snapshot: ServerProvider = {
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-23T12:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    };

    try {
      await expect(
        enrichProviderSnapshotWithVersionAdvisory(snapshot, {
          T3CODE_DEV_PROVIDER_UPDATE_ADVISORY: "codex:9.9.9",
        }),
      ).resolves.toMatchObject({
        versionAdvisory: {
          status: "behind_latest",
          latestVersion: "9.9.9",
          currentVersion: "1.0.0",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
