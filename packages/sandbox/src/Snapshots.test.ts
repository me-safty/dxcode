import type { SandboxSnapshotDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  isSandboxSnapshotStale,
  isSandboxSnapshotUsable,
  selectSandboxSnapshot,
} from "./Snapshots.ts";

function snapshot(overrides: Partial<SandboxSnapshotDescriptor> = {}): SandboxSnapshotDescriptor {
  return {
    snapshotId: "snapshot-1" as SandboxSnapshotDescriptor["snapshotId"],
    providerRef: {
      providerKind: "modal",
      externalId: "provider-snapshot-1",
    },
    status: "ready",
    projectKey: "github.com/t3tools/t3code",
    sourceBranch: "main",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Sandbox Snapshot helpers", () => {
  it("detects stale Snapshots by age or explicit status", () => {
    expect(
      isSandboxSnapshotStale(snapshot(), {
        now: new Date("2026-01-03T00:00:00.000Z"),
        maxAgeMs: 24 * 60 * 60 * 1000,
      }),
    ).toBe(true);
    expect(isSandboxSnapshotStale(snapshot({ status: "stale" }), {})).toBe(true);
  });

  it("only treats matching ready Snapshots as usable", () => {
    expect(
      isSandboxSnapshotUsable(snapshot(), {
        projectKey: "github.com/t3tools/t3code",
        sourceBranch: "main",
      }),
    ).toBe(true);
    expect(
      isSandboxSnapshotUsable(snapshot({ status: "failed" }), {
        projectKey: "github.com/t3tools/t3code",
        sourceBranch: "main",
      }),
    ).toBe(false);
  });

  it("selects the newest usable Snapshot and prefers exact commits", () => {
    const selected = selectSandboxSnapshot(
      [
        snapshot({
          snapshotId: "snapshot-old" as SandboxSnapshotDescriptor["snapshotId"],
          createdAt: "2026-01-01T00:00:00.000Z",
          sourceCommit: "old",
        }),
        snapshot({
          snapshotId: "snapshot-new" as SandboxSnapshotDescriptor["snapshotId"],
          createdAt: "2026-01-02T00:00:00.000Z",
          sourceCommit: "new",
        }),
        snapshot({
          snapshotId: "snapshot-exact" as SandboxSnapshotDescriptor["snapshotId"],
          createdAt: "2026-01-01T12:00:00.000Z",
          sourceCommit: "target",
        }),
      ],
      {
        projectKey: "github.com/t3tools/t3code",
        sourceBranch: "main",
        sourceCommit: "target",
      },
    );

    expect(selected?.snapshotId).toBe("snapshot-exact");
  });
});
