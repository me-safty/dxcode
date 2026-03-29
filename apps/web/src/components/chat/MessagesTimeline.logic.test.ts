import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  buildTimelineRows,
  computeMessageDurationStart,
  normalizeCompactToolLabel,
} from "./MessagesTimeline.logic";

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

describe("buildTimelineRows", () => {
  it("groups adjacent work entries, preserves plans, and appends the working row", () => {
    const rows = buildTimelineRows({
      timelineEntries: [
        {
          id: "message-1",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: MessageId.makeUnsafe("message-1"),
            role: "user",
            text: "hello",
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "work-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:01Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:01Z",
            label: "Ran command",
            tone: "tool",
          },
        },
        {
          id: "work-2",
          kind: "work",
          createdAt: "2026-01-01T00:00:02Z",
          entry: {
            id: "work-2",
            createdAt: "2026-01-01T00:00:02Z",
            label: "Updated file",
            tone: "info",
          },
        },
        {
          id: "plan-1",
          kind: "proposed-plan",
          createdAt: "2026-01-01T00:00:03Z",
          proposedPlan: {
            id: "plan-1" as never,
            turnId: null,
            planMarkdown: "1. Ship it",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-01-01T00:00:03Z",
            updatedAt: "2026-01-01T00:00:03Z",
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:04Z",
    });

    expect(rows).toEqual([
      {
        kind: "message",
        id: "message-1",
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: MessageId.makeUnsafe("message-1"),
          role: "user",
          text: "hello",
          createdAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
        durationStart: "2026-01-01T00:00:00Z",
        showCompletionDivider: false,
      },
      {
        kind: "work",
        id: "work-1",
        createdAt: "2026-01-01T00:00:01Z",
        groupedEntries: [
          {
            id: "work-1",
            createdAt: "2026-01-01T00:00:01Z",
            label: "Ran command",
            tone: "tool",
          },
          {
            id: "work-2",
            createdAt: "2026-01-01T00:00:02Z",
            label: "Updated file",
            tone: "info",
          },
        ],
      },
      {
        kind: "proposed-plan",
        id: "plan-1",
        createdAt: "2026-01-01T00:00:03Z",
        proposedPlan: {
          id: "plan-1" as never,
          turnId: null,
          planMarkdown: "1. Ship it",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-01-01T00:00:03Z",
          updatedAt: "2026-01-01T00:00:03Z",
        },
      },
      {
        kind: "working",
        id: "working-indicator-row",
        createdAt: "2026-01-01T00:00:04Z",
      },
    ]);
  });

  it("marks the matching assistant row with the completion divider", () => {
    const rows = buildTimelineRows({
      timelineEntries: [
        {
          id: "assistant-1",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: MessageId.makeUnsafe("assistant-1"),
            role: "assistant",
            text: "Done",
            createdAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:05Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-1",
      isWorking: false,
      activeTurnStartedAt: null,
    });

    expect(rows[0]).toMatchObject({
      kind: "message",
      id: "assistant-1",
      showCompletionDivider: true,
    });
  });
});
