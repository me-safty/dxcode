import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveNightlyReleaseMetadata } from "./resolve-nightly-release";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("resolveNightlyReleaseMetadata", () => {
  it("derives a nightly prerelease version and tag from the desktop package version", () => {
    const metadata = resolveNightlyReleaseMetadata({
      rootDir: repoRoot,
      date: "20260413",
      runNumber: "42",
      sha: "abcdef1234567890",
    });

    expect(metadata).toEqual({
      baseVersion: "0.0.17",
      version: "0.0.17-nightly.20260413.42",
      tag: "nightly-v0.0.17-nightly.20260413.42",
      name: "T3 Code Nightly 0.0.17-nightly.20260413.42 (abcdef123456)",
      shortSha: "abcdef123456",
    });
  });

  it("rejects invalid nightly metadata inputs", () => {
    expect(() =>
      resolveNightlyReleaseMetadata({
        rootDir: repoRoot,
        date: "2026-04-13",
        runNumber: "0",
        sha: "bad-sha",
      }),
    ).toThrow(/Invalid nightly release date/);
  });
});
