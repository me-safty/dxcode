import { describe, expect, it } from "vite-plus/test";

import { buildReviewParsedDiff } from "../review/reviewModel";
import {
  SHOWCASE_DIFF,
  SHOWCASE_NOW,
  SHOWCASE_SCENES,
  SHOWCASE_TERMINAL_BUFFER,
  createShowcaseFixture,
} from "./showcaseData";

describe("showcase fixture", () => {
  it("stays deterministic for a supplied clock", () => {
    const now = Date.parse("2026-07-15T09:41:00.000Z");
    expect(createShowcaseFixture(now)).toEqual(createShowcaseFixture(now));
  });

  it("uses a fixed default clock across device captures", () => {
    expect(createShowcaseFixture()).toEqual(createShowcaseFixture(SHOWCASE_NOW));
  });

  it("contains distinct scenes and enough polished content for captures", () => {
    const fixture = createShowcaseFixture(Date.parse("2026-07-15T09:41:00.000Z"));
    expect(new Set(SHOWCASE_SCENES).size).toBe(SHOWCASE_SCENES.length);
    expect(fixture.threads).toHaveLength(4);
    expect(fixture.feed.filter((entry) => entry.type === "message")).toHaveLength(2);
    expect(SHOWCASE_TERMINAL_BUFFER).toContain("All checks passed");
  });

  it("uses a parseable multi-file review diff", () => {
    const parsed = buildReviewParsedDiff(SHOWCASE_DIFF, "showcase-test");
    expect(parsed.kind).toBe("files");
    if (parsed.kind === "files") {
      expect(parsed.fileCount).toBe(2);
      expect(parsed.additions).toBeGreaterThan(10);
      expect(parsed.deletions).toBeGreaterThan(0);
    }
  });
});
