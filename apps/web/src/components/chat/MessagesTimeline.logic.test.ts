import { describe, expect, it } from "vitest";
import { type MessageId } from "@t3tools/contracts";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import {
  computeActiveMinimapIndex,
  selectUserMessageMinimapEntries,
  type MinimapListStateSnapshot,
  type MinimapUserMessageEntry,
} from "./ChatMinimap.logic";

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous assistant completedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message without completedAt", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", createdAt: "2026-01-01T00:00:30Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      { id: "u2", role: "user", createdAt: "2026-01-01T00:01:00Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        completedAt: "2026-01-01T00:01:20Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s1", role: "system", createdAt: "2026-01-01T00:00:01Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-final-entry",
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
    expect(assistantRows[1]?.showCompletionDivider).toBe(true);
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      files: [{ path: "src/index.ts", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });
});

describe("selectUserMessageMinimapEntries", () => {
  it("returns an empty array when no rows are present", () => {
    expect(selectUserMessageMinimapEntries([])).toEqual([]);
  });

  it("returns an empty array when no rows are user messages", () => {
    const rows: MessagesTimelineRow[] = [
      {
        kind: "message",
        id: "entry-a1",
        createdAt: "2026-01-01T00:00:10Z",
        message: {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Hello",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:10Z",
          completedAt: "2026-01-01T00:00:11Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:10Z",
        showCompletionDivider: false,
        showAssistantCopyButton: false,
      },
      {
        kind: "work",
        id: "entry-work-1",
        createdAt: "2026-01-01T00:00:05Z",
        groupedEntries: [
          {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            label: "thinking",
            tone: "thinking",
          },
        ],
      },
    ];

    expect(selectUserMessageMinimapEntries(rows)).toEqual([]);
  });

  it("captures the original rowIndex for user message rows in a mixed list", () => {
    const rows: MessagesTimelineRow[] = [
      {
        kind: "work",
        id: "entry-work-1",
        createdAt: "2026-01-01T00:00:00Z",
        groupedEntries: [
          {
            id: "work-1",
            createdAt: "2026-01-01T00:00:00Z",
            label: "thinking",
            tone: "thinking",
          },
        ],
      },
      {
        kind: "message",
        id: "entry-user-1",
        createdAt: "2026-01-01T00:00:05Z",
        message: {
          id: "user-1" as never,
          role: "user",
          text: "First message",
          turnId: null,
          createdAt: "2026-01-01T00:00:05Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:05Z",
        showCompletionDivider: false,
        showAssistantCopyButton: false,
      },
      {
        kind: "message",
        id: "entry-a1",
        createdAt: "2026-01-01T00:00:10Z",
        message: {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Reply",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:10Z",
          completedAt: "2026-01-01T00:00:11Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:05Z",
        showCompletionDivider: false,
        showAssistantCopyButton: true,
      },
      {
        kind: "message",
        id: "entry-user-2",
        createdAt: "2026-01-01T00:00:20Z",
        message: {
          id: "user-2" as never,
          role: "user",
          text: "Second message",
          turnId: null,
          createdAt: "2026-01-01T00:00:20Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:20Z",
        showCompletionDivider: false,
        showAssistantCopyButton: false,
      },
    ];

    const entries = selectUserMessageMinimapEntries(rows);
    expect(entries).toEqual([
      {
        rowIndex: 1,
        rowKey: "entry-user-1",
        messageId: "user-1",
        previewText: "First message",
      },
      {
        rowIndex: 3,
        rowKey: "entry-user-2",
        messageId: "user-2",
        previewText: "Second message",
      },
    ]);
  });

  it("strips trailing terminal context blocks from the preview text", () => {
    const rows: MessagesTimelineRow[] = [
      {
        kind: "message",
        id: "entry-user-1",
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: "user-1" as never,
          role: "user",
          text: "Look at the log\n\n<terminal_context>\n- session 1:\nhello\nworld\n</terminal_context>",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:00Z",
        showCompletionDivider: false,
        showAssistantCopyButton: false,
      },
    ];

    const entries = selectUserMessageMinimapEntries(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.previewText).toBe("Look at the log");
  });

  it("falls back to a placeholder when the visible text is empty but a terminal context exists", () => {
    const rows: MessagesTimelineRow[] = [
      {
        kind: "message",
        id: "entry-user-1",
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: "user-1" as never,
          role: "user",
          text: "<terminal_context>\n- session 1:\nhello\n</terminal_context>",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:00Z",
        showCompletionDivider: false,
        showAssistantCopyButton: false,
      },
    ];

    const entries = selectUserMessageMinimapEntries(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.previewText).toBe("(terminal context)");
  });
});

describe("computeActiveMinimapIndex", () => {
  const makeEntry = (i: number, rowKey: string): MinimapUserMessageEntry => ({
    rowIndex: i * 2,
    rowKey,
    messageId: `user-${i}` as MessageId,
    previewText: `msg ${i}`,
  });

  const makeState = ({
    scroll,
    scrollLength = 500,
    positionsByKey = {},
    positionsByIndex = {},
  }: {
    scroll: number;
    scrollLength?: number;
    positionsByKey?: Record<string, number>;
    positionsByIndex?: Record<number, number>;
  }): MinimapListStateSnapshot => ({
    scroll,
    scrollLength,
    positionByKey: (key) => positionsByKey[key],
    positionAtIndex: (index) => positionsByIndex[index],
  });

  it("returns undefined when there are no entries so the caller leaves state alone", () => {
    expect(computeActiveMinimapIndex(makeState({ scroll: 0 }), [])).toBeUndefined();
  });

  it("returns undefined before the list has been measured (scrollLength is 0)", () => {
    const a = makeEntry(1, "a");
    const state = makeState({
      scroll: 0,
      scrollLength: 0,
      positionsByKey: { a: 100 },
    });
    expect(computeActiveMinimapIndex(state, [a])).toBeUndefined();
  });

  it("keeps the first entry active while the user is at the very top of the thread", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const state = makeState({ scroll: 0, positionsByKey: { a: 100, b: 900 } });
    expect(computeActiveMinimapIndex(state, [a, b])).toBe(0);
  });

  it("keeps the first entry active while the next entry's top is still below the viewport top", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const state = makeState({ scroll: 500, positionsByKey: { a: 100, b: 900 } });
    expect(computeActiveMinimapIndex(state, [a, b])).toBe(0);
  });

  it("activates the next entry once its top has scrolled at/above the viewport top", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const c = makeEntry(3, "c");
    const state = makeState({
      scroll: 1000,
      positionsByKey: { a: 100, b: 900, c: 1700 },
    });
    expect(computeActiveMinimapIndex(state, [a, b, c])).toBe(1);
  });

  it("activates the last entry when its top finally reaches the viewport top", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const c = makeEntry(3, "c");
    // scroll=1700 → threshold=1708. All three satisfy → c active.
    const state = makeState({
      scroll: 1700,
      positionsByKey: { a: 100, b: 900, c: 1700 },
    });
    expect(computeActiveMinimapIndex(state, [a, b, c])).toBe(2);
  });

  it("does not activate the last entry when max scroll can't push its top above the viewport top", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const c = makeEntry(3, "c");
    const state = makeState({
      scroll: 1500,
      scrollLength: 500,
      positionsByKey: { a: 100, b: 900, c: 1700 },
    });
    expect(computeActiveMinimapIndex(state, [a, b, c])).toBe(1);
  });

  it("advances past a prompt whose body has scrolled off when the next prompt enters from below", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const c = makeEntry(3, "c");
    const state = makeState({
      scroll: 200,
      positionsByKey: { a: 100, b: 500, c: 1200 },
      positionsByIndex: { 3: 150, 5: 550 },
    });
    expect(computeActiveMinimapIndex(state, [a, b, c])).toBe(1);
  });

  it("does not advance past a prompt while any part of it is still visible", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const state = makeState({
      scroll: 100,
      positionsByKey: { a: 100, b: 500 },
      positionsByIndex: { 3: 150 },
    });
    expect(computeActiveMinimapIndex(state, [a, b])).toBe(0);
  });

  it("does not advance when the next prompt hasn't entered the viewport yet", () => {
    const a = makeEntry(1, "a");
    const b = makeEntry(2, "b");
    const c = makeEntry(3, "c");
    const state = makeState({
      scroll: 600,
      positionsByKey: { a: 100, b: 500, c: 1200 },
      positionsByIndex: { 3: 150, 5: 550 },
    });
    expect(computeActiveMinimapIndex(state, [a, b, c])).toBe(1);
  });
});
