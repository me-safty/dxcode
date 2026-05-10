import { assert, it } from "@effect/vitest";

import { buildTimingSamples, calculateTimingStats } from "./core.ts";

it("calculates timing stats with stable percentile boundaries", () => {
  assert.deepEqual(calculateTimingStats([]), {
    count: 0,
    totalMs: 0,
    meanMs: 0,
    p50Ms: 0,
    p90Ms: 0,
    p99Ms: 0,
    maxMs: 0,
  });

  assert.deepEqual(calculateTimingStats([4, 1, 2, 3]), {
    count: 4,
    totalMs: 10,
    meanMs: 2.5,
    p50Ms: 2,
    p90Ms: 4,
    p99Ms: 4,
    maxMs: 4,
  });
});

it("builds contiguous timing samples", () => {
  assert.deepEqual(buildTimingSamples([1, 2, 3, 4, 5], 2), [
    {
      fromEvent: 1,
      toEvent: 2,
      stats: calculateTimingStats([1, 2]),
    },
    {
      fromEvent: 3,
      toEvent: 4,
      stats: calculateTimingStats([3, 4]),
    },
    {
      fromEvent: 5,
      toEvent: 5,
      stats: calculateTimingStats([5]),
    },
  ]);
});
