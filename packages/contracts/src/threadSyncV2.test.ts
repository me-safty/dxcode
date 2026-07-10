import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { EnvironmentId } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import { OrchestrationThreadV2StreamItem } from "./orchestration.ts";

describe("thread sync v2 contracts", () => {
  it("defaults old descriptors to legacy JSON and sync v1", () => {
    const descriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor)({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Desktop",
      platform: { os: "windows", arch: "x64" },
      serverVersion: "0.0.1",
      capabilities: { repositoryIdentity: false },
    });
    expect(descriptor.rpcTransports).toEqual([{ kind: "json", path: "/ws" }]);
    expect(descriptor.threadSyncVersions).toEqual([1]);
  });

  it("decodes v2 staging and control frames", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationThreadV2StreamItem);
    expect(
      decode({
        kind: "snapshot-start",
        snapshotId: "snapshot-1",
        historyEpoch: 7,
        watermark: 42,
        chunkCount: 2,
        inlineBytes: 1024,
      }).kind,
    ).toBe("snapshot-start");
    expect(
      decode({
        kind: "snapshot-chunk",
        snapshotId: "snapshot-1",
        index: 0,
        messages: [],
        activities: [],
      }).kind,
    ).toBe("snapshot-chunk");
    expect(
      decode({
        kind: "snapshot-complete",
        snapshotId: "snapshot-1",
        historyEpoch: 7,
        lastAppliedSequence: 42,
        before: { message: null, activity: null },
        hasOlderMessages: false,
        hasOlderActivities: false,
      }).kind,
    ).toBe("snapshot-complete");
    expect(decode({ kind: "keepalive", sequence: 42 }).kind).toBe("keepalive");
    expect(
      decode({
        kind: "catchup",
        historyEpoch: 7,
        fromSequence: 40,
        toSequence: 42,
        eventCount: 2,
      }).kind,
    ).toBe("catchup");
    expect(decode({ kind: "resync-required", reason: "live-buffer-overflow" }).kind).toBe(
      "resync-required",
    );
  });
});
