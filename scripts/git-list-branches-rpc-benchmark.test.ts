import { describe, expect, it } from "vitest";

import { runGitListBranchesRpcBenchmark } from "./lib/git-list-branches-rpc-benchmark";

describe("runGitListBranchesRpcBenchmark", () => {
  it("measures a real websocket RPC round trip for git.listBranches", async () => {
    const report = await runGitListBranchesRpcBenchmark({
      fixtureValue: {
        branches: [
          {
            name: "main",
            isRemote: false,
            current: true,
            isDefault: true,
            worktreePath: "/tmp/repo",
          },
          {
            name: "feature/perf-bench",
            isRemote: false,
            current: false,
            isDefault: false,
            worktreePath: null,
          },
        ],
        isRepo: true,
        hasOriginRemote: true,
        nextCursor: null,
        totalCount: 2,
      },
      iterations: 3,
      warmupIterations: 1,
    });

    expect(report.traces).toHaveLength(3);
    expect(report.observedResult).toEqual({
      branchCount: 2,
      currentBranchName: "main",
      hasOriginRemote: true,
      isRepo: true,
    });

    for (const trace of report.traces) {
      expect(trace.requestId.length).toBeGreaterThan(0);
      expect(trace.durationsMs.e2eMs).toBeGreaterThanOrEqual(0);
      expect(trace.durationsMs.serverDecodeDispatchMs).toBeGreaterThanOrEqual(0);
      expect(trace.durationsMs.serverHandlerMs).toBeGreaterThanOrEqual(0);
      expect(trace.durationsMs.clientDecodeResolveMs).toBeGreaterThanOrEqual(0);
    }
  });
});
