import { describe, expect, it } from "vite-plus/test";

import {
  parseDiffRouteSearch,
  parseSideChatTargets,
  serializeSideChatTarget,
  serializeSideChatTargets,
} from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("keeps file value without a turn (file selection works for any source)", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffFilePath: "src/app.ts",
    });
  });

  it("parses the diff source param", () => {
    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffSource: "branch",
      }),
    ).toEqual({
      diff: "1",
      diffSource: "branch",
    });

    expect(
      parseDiffRouteSearch({
        diff: "1",
        diffSource: "not-a-source",
      }),
    ).toEqual({
      diff: "1",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("parses and normalizes side chat targets alongside diff params", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      sideChats: "s:env-1:thread-1,d:draft-1,s:env-1:thread-1",
      sideChatActive: "d:draft-1",
    });

    expect(parsed).toEqual({
      diff: "1",
      sideChats: "s:env-1:thread-1,d:draft-1",
      sideChatActive: "d:draft-1",
    });
    expect(parseSideChatTargets(parsed.sideChats)).toEqual([
      { kind: "server", environmentId: "env-1", threadId: "thread-1" },
      { kind: "draft", draftId: "draft-1" },
    ]);
  });

  it("drops an active side chat value that is not open", () => {
    expect(
      parseDiffRouteSearch({
        sideChats: "s:env-1:thread-1",
        sideChatActive: "d:draft-1",
      }),
    ).toEqual({
      sideChats: "s:env-1:thread-1",
    });
  });

  it("serializes side chat targets for URL storage", () => {
    const serverTarget = {
      kind: "server" as const,
      environmentId: "env:with:colon" as never,
      threadId: "thread/1" as never,
    };
    const draftTarget = { kind: "draft" as const, draftId: "draft 1" as never };

    expect(serializeSideChatTarget(serverTarget)).toBe("s:env%3Awith%3Acolon:thread%2F1");
    expect(serializeSideChatTargets([serverTarget, draftTarget])).toBe(
      "s:env%3Awith%3Acolon:thread%2F1,d:draft%201",
    );
    expect(parseSideChatTargets("s:env%3Awith%3Acolon:thread%2F1,d:draft%201")).toEqual([
      { kind: "server", environmentId: "env:with:colon", threadId: "thread/1" },
      { kind: "draft", draftId: "draft 1" },
    ]);
  });
});
