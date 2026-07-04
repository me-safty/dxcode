import { describe, expect, it } from "vite-plus/test";

import { normalizeCodexUsage } from "./CodexUsage.ts";

describe("normalizeCodexUsage", () => {
  it("normalizes account identity and primary/weekly windows", () => {
    expect(
      normalizeCodexUsage({
        account: { type: "chatgpt", email: "codex@example.com", planType: "plus" },
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 11, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
          planType: "plus",
        },
      }),
    ).toEqual({
      email: "codex@example.com",
      planType: "plus",
      primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 11, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
    });
  });
});
