import { describe, expect, it } from "vite-plus/test";
import { projectEntryText, buildMatches, reconcileActiveMatch } from "./chatSearch";
import type { TimelineEntry } from "../../session-logic";

function messageEntry(text: string): TimelineEntry {
  return {
    id: "m1",
    kind: "message",
    createdAt: "2026-01-01T00:00:00.000Z",
    message: {
      id: "m1",
      role: "assistant",
      text,
      turnId: null,
      streaming: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  } as TimelineEntry;
}

describe("projectEntryText", () => {
  it("strips inline markdown to plain text", () => {
    const [unit] = projectEntryText(messageEntry("see `auth.ts` in **src**"));
    expect(unit).toEqual({ field: "text", text: "see auth.ts in src" });
  });

  it("keeps code-fence body verbatim", () => {
    const [unit] = projectEntryText(messageEntry("```js\nconst x = 1;\n```"));
    expect(unit?.text).toBe("const x = 1;");
  });

  it("drops link URLs, keeps label", () => {
    const [unit] = projectEntryText(messageEntry("open [auth.ts](http://x/y)"));
    expect(unit?.text).toBe("open auth.ts");
  });

  it("returns [] for empty message text", () => {
    expect(projectEntryText(messageEntry(""))).toEqual([]);
  });
});

function msg(id: string, text: string, createdAt: string): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt,
    message: {
      id,
      role: "assistant",
      text,
      turnId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    },
  } as TimelineEntry;
}

describe("buildMatches", () => {
  const entries = [
    msg("a", "find the foo and Foo", "2026-01-01T00:00:00.000Z"),
    msg("b", "another foo here", "2026-01-01T00:00:01.000Z"),
  ];

  it("counts case-insensitive matches across entries in timeline order", () => {
    const matches = buildMatches(entries, "foo", { caseSensitive: false });
    expect(matches.map((m) => m.entryId)).toEqual(["a", "a", "b"]);
    expect(matches.map((m) => m.occurrence)).toEqual([0, 1, 0]);
    expect(matches[0]).toMatchObject({ start: 9, end: 12, field: "text" });
  });

  it("honors case-sensitivity", () => {
    const matches = buildMatches(entries, "Foo", { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.entryId).toBe("a");
  });

  it("returns [] for an empty query", () => {
    expect(buildMatches(entries, "", { caseSensitive: false })).toEqual([]);
  });

  it("keeps offsets in the original string under length-changing folds", () => {
    const [m] = buildMatches([msg("a", "straße", "2026-01-01T00:00:00.000Z")], "STRASSE", {
      caseSensitive: false,
    });
    // 'ß' upper-cases to 'SS' (length-changing) but offsets index the original text.
    expect(m).toMatchObject({ start: 0, end: 6 });
  });
});

describe("reconcileActiveMatch", () => {
  const mk = (id: string): import("./chatSearch").Match => ({
    matchId: id,
    entryId: id,
    entryKind: "message",
    turnId: null,
    field: "text",
    occurrence: 0,
    start: 0,
    end: 1,
  });

  it("re-finds the anchored match after the set grows", () => {
    const next = [mk("x"), mk("y"), mk("z")];
    expect(reconcileActiveMatch(next, "y", 0)).toBe(1);
  });

  it("clamps when the anchored match vanished", () => {
    expect(reconcileActiveMatch([mk("x")], "gone", 5)).toBe(0);
  });

  it("clamps negative prevIndex to 0", () => {
    expect(reconcileActiveMatch([mk("x")], "gone", -3)).toBe(0);
  });

  it("returns 0 for an empty set", () => {
    expect(reconcileActiveMatch([], "x", 3)).toBe(0);
  });
});
