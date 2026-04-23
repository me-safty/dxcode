import { describe, expect, it } from "vitest";
import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";

import {
  collectProviderUpdateCandidates,
  collectUpdatedProviderSnapshots,
  firstRejectedProviderUpdateMessage,
  getProviderUpdateInitialToastView,
  getProviderUpdateProgressToastView,
  getProviderUpdateRejectedToastView,
  isProviderUpdateCandidate,
  providerUpdateNotificationKey,
  type ProviderUpdateCandidate,
} from "./ProviderUpdateLaunchNotification.logic";

const checkedAt = "2026-04-23T10:00:00.000Z";

function provider(input: {
  readonly driver: ProviderDriverKind;
  readonly instanceId?: string;
  readonly enabled?: boolean;
  readonly version?: string | null;
  readonly latestVersion?: string | null;
  readonly canUpdate?: boolean;
  readonly updateState?: ServerProvider["updateState"];
  readonly advisoryStatus?: NonNullable<ServerProvider["versionAdvisory"]>["status"];
}): ServerProvider {
  const result: ServerProvider = {
    instanceId: input.instanceId ?? input.driver,
    driver: input.driver,
    enabled: input.enabled ?? true,
    installed: true,
    version: input.version ?? "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: input.advisoryStatus ?? "behind_latest",
      currentVersion: input.version ?? "1.0.0",
      latestVersion: "latestVersion" in input ? input.latestVersion : "1.1.0",
      updateCommand: "npm install -g provider",
      canUpdate: input.canUpdate ?? true,
      checkedAt,
      message: "Update available.",
    },
  };
  if (input.updateState) {
    return { ...result, updateState: input.updateState };
  }
  return result;
}

function updateCandidate(input: Parameters<typeof provider>[0]): ProviderUpdateCandidate {
  return provider(input) as ProviderUpdateCandidate;
}

describe("provider update launch notification logic", () => {
  it("detects enabled providers with a latest-version advisory", () => {
    expect(isProviderUpdateCandidate(provider({ driver: "codex" }))).toBe(true);
    expect(isProviderUpdateCandidate(provider({ driver: "codex", enabled: false }))).toBe(false);
    expect(
      isProviderUpdateCandidate(
        provider({ driver: "codex", advisoryStatus: "current", latestVersion: null }),
      ),
    ).toBe(false);
    expect(isProviderUpdateCandidate(provider({ driver: "codex", latestVersion: null }))).toBe(
      false,
    );
  });

  it("deduplicates multi-instance provider candidates by driver", () => {
    expect(
      collectProviderUpdateCandidates([
        provider({ driver: "codex", instanceId: "codex_personal", latestVersion: "1.1.0" }),
        provider({ driver: "codex", instanceId: "codex", latestVersion: "1.1.0" }),
        provider({ driver: "cursor", latestVersion: "0.3.0" }),
      ]),
    ).toHaveLength(2);
  });

  it("builds a notification key from the update advisory fields", () => {
    const codex = updateCandidate({
      driver: "codex",
      version: "1.0.0",
      latestVersion: "1.1.0",
    });
    const cursor = updateCandidate({
      driver: "cursor",
      version: "0.2.0",
      latestVersion: "0.3.0",
    });

    expect(providerUpdateNotificationKey([codex, cursor])).toBe(
      "codex:behind_latest:1.0.0:1.1.0:Update available.|cursor:behind_latest:0.2.0:0.3.0:Update available.",
    );
    expect(providerUpdateNotificationKey([])).toBeNull();
  });

  it("describes a single one-click update", () => {
    const view = getProviderUpdateInitialToastView({
      updateProviders: [updateCandidate({ driver: "codex", latestVersion: "1.1.0" })],
      oneClickProviders: [updateCandidate({ driver: "codex", latestVersion: "1.1.0" })],
    });

    expect(view).toMatchObject({
      phase: "initial",
      type: "warning",
      title: "Update Available: Codex v1.1.0",
      description: "Install the update now or review provider settings.",
    });
  });

  it("describes settings-only updates without one-click support", () => {
    const view = getProviderUpdateInitialToastView({
      updateProviders: [
        updateCandidate({ driver: "codex", canUpdate: false }),
        updateCandidate({ driver: "cursor", canUpdate: false }),
      ],
      oneClickProviders: [],
    });

    expect(view.description).toBe("Codex and Cursor can be updated from provider settings.");
  });

  it("uses server update state for running progress", () => {
    const view = getProviderUpdateProgressToastView({
      providers: [
        provider({
          driver: "codex",
          updateState: {
            status: "running",
            startedAt: checkedAt,
            finishedAt: null,
            message: "Updating provider.",
            output: null,
          },
        }),
      ],
      providerCount: 1,
    });

    expect(view).toMatchObject({
      phase: "running",
      type: "loading",
      title: "Updating provider",
    });
  });

  it("uses server failure state for failed progress", () => {
    const view = getProviderUpdateProgressToastView({
      providers: [
        provider({
          driver: "codex",
          updateState: {
            status: "failed",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "command failed",
            output: "stderr",
          },
        }),
      ],
      providerCount: 1,
    });

    expect(view).toMatchObject({
      phase: "failed",
      type: "error",
      title: "Provider update failed",
      description: "command failed",
    });
  });

  it("keeps unchanged providers actionable from settings", () => {
    const view = getProviderUpdateProgressToastView({
      providers: [
        provider({
          driver: "cursor",
          updateState: {
            status: "unchanged",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "still old",
            output: null,
          },
        }),
      ],
      providerCount: 1,
    });

    expect(view).toMatchObject({
      phase: "unchanged",
      type: "warning",
      title: "Provider still needs an update",
      description: "Cursor still appears outdated. Check provider settings for details.",
    });
  });

  it("marks progress succeeded once every attempted provider is no longer outdated", () => {
    const view = getProviderUpdateProgressToastView({
      providers: [
        provider({
          driver: "codex",
          version: "1.1.0",
          latestVersion: "1.1.0",
          advisoryStatus: "current",
          updateState: {
            status: "succeeded",
            startedAt: checkedAt,
            finishedAt: checkedAt,
            message: "Provider updated.",
            output: null,
          },
        }),
      ],
      providerCount: 1,
    });

    expect(view).toMatchObject({
      phase: "succeeded",
      type: "success",
      title: "Provider updated",
      dismissAfterVisibleMs: 10_000,
    });
  });

  it("falls back to a rejected RPC message for transport-level failures", () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: "rejected", reason: new Error("WebSocket closed") },
    ];

    expect(firstRejectedProviderUpdateMessage(results)).toBe("WebSocket closed");
    expect(getProviderUpdateRejectedToastView(2, "WebSocket closed")).toMatchObject({
      phase: "failed",
      title: "Provider updates failed",
      description: "WebSocket closed",
    });
  });

  it("collects only attempted provider snapshots from update responses", () => {
    const codex = provider({ driver: "codex" });
    const cursor = provider({ driver: "cursor" });
    const results: PromiseSettledResult<{ readonly providers: ReadonlyArray<ServerProvider> }>[] = [
      { status: "fulfilled", value: { providers: [codex, cursor] } },
    ];

    expect(
      collectUpdatedProviderSnapshots({
        results,
        providerKinds: new Set<ProviderDriverKind>(["cursor"]),
      }),
    ).toEqual([cursor]);
  });
});
