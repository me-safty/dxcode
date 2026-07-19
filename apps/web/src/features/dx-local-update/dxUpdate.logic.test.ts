import { assert, describe, it } from "@effect/vitest";

import { dxUpdateSummary } from "./dxUpdate.logic";

describe("dxUpdateSummary", () => {
  it("groups remote DX and nightly updates", () => {
    const summary = dxUpdateSummary({
      status: "available",
      checkedAt: "2026-07-19T00:00:00.000Z",
      reasons: [
        {
          kind: "origin-dx-main",
          installedCommit: "1".repeat(40),
          remoteCommit: "2".repeat(40),
          commitsBehind: 12,
        },
        {
          kind: "upstream-nightly",
          target: {
            policy: "nightly-tags",
            tag: "v0.0.29-nightly.20260719.843",
            commit: "3".repeat(40),
            remote: "upstream",
          },
        },
      ],
    });

    assert.deepStrictEqual(summary, {
      title: "DX + T3 updates available",
      description: "12 DX commits · v0.0.29-nightly.20260719.843",
    });
  });
});
