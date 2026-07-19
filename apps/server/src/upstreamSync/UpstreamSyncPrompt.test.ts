import { assert, describe, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";

import { buildUpstreamSyncPrompt } from "./UpstreamSyncPrompt.ts";

describe("buildUpstreamSyncPrompt", () => {
  it("keeps dismissed-nightly counts on the pinned session", () => {
    const prompt = buildUpstreamSyncPrompt({
      session: {
        id: "session-1",
        sourceProjectId: ProjectId.make("project-1"),
        target: {
          policy: "nightly-tags",
          tag: "v0.0.29-nightly.20260719.828",
          commit: "1a2b3c4",
          remote: "upstream",
        },
        commitCount: 49,
        newerNightlyCount: 3,
        metricsHydrated: true,
        remoteTagObject: "1a2b3c4",
        branch: "sync/t3-nightly-20260719-828",
        worktreePath: "/tmp/sync-t3-nightly-20260719-828",
        status: "ready",
        conflictFiles: [],
        comparison: {
          baseCommit: "abc1234",
          upstreamFileCount: 49,
          dxFileCount: 12,
          overlappingFiles: [],
        },
        threadId: null,
        createdAt: "2026-07-19T00:00:00.000Z",
      },
    });

    assert.include(prompt, "New commits: 49");
    assert.include(prompt, "Newer nightly tags since previous notification: 3");
  });
});
