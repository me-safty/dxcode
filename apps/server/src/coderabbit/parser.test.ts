import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCodeRabbitAuthStatusOutput, parseCodeRabbitCliLine } from "./parser";

function readFixture(name: string) {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

describe("CodeRabbit parser", () => {
  it("parses auth status fixtures", () => {
    const result = parseCodeRabbitAuthStatusOutput(readFixture("auth-status.ndjson"));

    expect(result).toEqual({
      authenticated: true,
      rawStatus: "authenticated",
    });
  });

  it("parses uncommitted review fixtures", () => {
    const events = readFixture("review-uncommitted.ndjson")
      .trim()
      .split("\n")
      .map((line) => parseCodeRabbitCliLine(line));

    expect(events.map((event) => event?.kind)).toEqual([
      "review_context",
      "status",
      "status",
      "status",
      "status",
      "finding",
      "finding",
      "finding",
      "finding",
      "finding",
      "finding",
      "complete",
    ]);

    const firstFinding = events.find((event) => event?.kind === "finding");
    expect(firstFinding?.kind).toBe("finding");
    if (firstFinding?.kind === "finding") {
      expect(firstFinding.finding.filePath).toBe(
        "docs/superpowers/specs/2026-04-05-coderabbit-integration-design.md",
      );
      expect(firstFinding.finding.location.type).toBe("file");
      expect(firstFinding.finding.summary).toContain("TerminalThreadState");
    }
  });

  it("parses committed review fixture errors", () => {
    const events = readFixture("review-committed.ndjson")
      .trim()
      .split("\n")
      .map((line) => parseCodeRabbitCliLine(line));

    expect(events.map((event) => event?.kind)).toEqual(["review_context", "error"]);
    expect(events[1]).toMatchObject({
      kind: "error",
      message: "Review failed: No files found for review",
    });
  });
});
