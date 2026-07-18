import { describe, expect, it } from "vite-plus/test";
import type { UpstreamUpdateState } from "@t3tools/contracts";

import { groupedNightlyLabel, upstreamPillView } from "./upstreamUpdate.logic";

const available: UpstreamUpdateState = {
  status: "available",
  target: {
    policy: "nightly-tags",
    tag: "v0.0.29-nightly.20260719.828",
    commit: "1a2b3c4d5e6f",
    remote: "upstream",
  },
  commitCount: 49,
  newerNightlyCount: 3,
  previousDismissedTag: "v0.0.29-nightly.20260716.825",
  release: null,
  checkedAt: "2026-07-19T00:00:00.000Z",
};

describe("upstream update presentation", () => {
  it("shows one latest nightly pill", () => {
    expect(upstreamPillView(available)).toMatchObject({
      title: "T3 nightly available",
      description: "v0.0.29-nightly.20260719.828 · 49 commits",
    });
    expect(groupedNightlyLabel(available.newerNightlyCount)).toBe("3 newer nightly tags");
  });

  it("hides dismissed state", () => {
    expect(
      upstreamPillView({
        status: "dismissed",
        target: available.target,
        checkedAt: available.checkedAt,
      }),
    ).toBeNull();
  });
});
