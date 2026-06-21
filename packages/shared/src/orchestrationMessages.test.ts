import { describe, expect, it } from "vite-plus/test";

import {
  applyAssistantSegmentMessageUpdate,
  type AssistantSegmentThreadMessage,
  assistantSegmentBelongsToActiveTurn,
  assistantSegmentStreamingTextResets,
  assistantSegmentTurnChanged,
  archivedAssistantSegmentMessageId,
  archivedAssistantSegmentTurnIds,
  isLateAssistantSegmentFromPriorTurn,
  isLateStreamingOnCompletedAssistant,
  repointCheckpointsForArchivedAssistantSegment,
  resolveAssistantSegmentText,
} from "./orchestrationMessages.ts";

describe("orchestrationMessages", () => {
  it("detects assistant segment turn rebinding", () => {
    expect(
      assistantSegmentTurnChanged({ turnId: "turn-a", streaming: false }, { turnId: "turn-b" }),
    ).toBe(true);
    expect(
      assistantSegmentTurnChanged({ turnId: "turn-a", streaming: false }, { turnId: "turn-a" }),
    ).toBe(false);
  });

  it("treats in-flight null turnId bind as continuation", () => {
    expect(
      assistantSegmentTurnChanged({ turnId: null, streaming: true }, { turnId: "turn-a" }),
    ).toBe(false);
  });

  it("only treats null-turn chunks as active when the existing row belongs to the active turn", () => {
    expect(
      assistantSegmentBelongsToActiveTurn({
        activeTurnId: "turn-b",
        existingTurnId: "turn-a",
        incomingTurnId: null,
      }),
    ).toBe(false);
    expect(
      assistantSegmentBelongsToActiveTurn({
        activeTurnId: "turn-b",
        existingTurnId: "turn-b",
        incomingTurnId: null,
      }),
    ).toBe(true);
    expect(
      assistantSegmentBelongsToActiveTurn({
        activeTurnId: "turn-b",
        existingTurnId: undefined,
        incomingTurnId: null,
      }),
    ).toBe(true);
  });

  it("treats completed replay rebind as a turn change", () => {
    expect(
      assistantSegmentTurnChanged({ turnId: null, streaming: false }, { turnId: "turn-a" }),
    ).toBe(true);
  });

  it("accepts trailing streaming chunks for the same settled turn", () => {
    expect(
      isLateStreamingOnCompletedAssistant({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: "turn-a",
        },
      }),
    ).toBe(false);
  });

  it("accepts resumed streaming on the active turn after segment-level completion", () => {
    expect(
      isLateStreamingOnCompletedAssistant({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: "turn-a",
        },
        turnStillActive: true,
      }),
    ).toBe(false);
  });

  it("still accepts streaming chunks for in-flight assistant messages", () => {
    expect(
      isLateStreamingOnCompletedAssistant({
        existing: {
          role: "assistant",
          streaming: true,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: "turn-a",
        },
      }),
    ).toBe(false);
  });

  it("still accepts the first rebound delta before turnId is known", () => {
    expect(
      isLateStreamingOnCompletedAssistant({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: null,
        },
      }),
    ).toBe(false);
  });

  it("still accepts assistant chunks when the segment rebinds to a new turn", () => {
    expect(
      isLateStreamingOnCompletedAssistant({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: "turn-b",
        },
      }),
    ).toBe(false);
  });

  it("resets streaming text on the first null-turn rebound chunk", () => {
    expect(
      assistantSegmentStreamingTextResets(
        { role: "assistant", streaming: false, turnId: "turn-a" },
        { streaming: true, turnId: null },
      ),
    ).toBe(true);
    expect(
      assistantSegmentStreamingTextResets(
        { role: "assistant", streaming: true, turnId: null },
        { streaming: true, turnId: "turn-a" },
      ),
    ).toBe(false);
  });

  it("keeps appending null-turn chunks while the turn is still active", () => {
    expect(
      assistantSegmentStreamingTextResets(
        { role: "assistant", streaming: false, turnId: "turn-a" },
        { streaming: true, turnId: null },
        { activeTurnId: "turn-a", turnStillActive: true },
      ),
    ).toBe(false);
  });

  it("resets null-turn rebound chunks when the completed row belongs to a prior turn", () => {
    expect(
      assistantSegmentStreamingTextResets(
        { role: "assistant", streaming: false, turnId: "turn-a" },
        { streaming: true, turnId: null },
        { activeTurnId: "turn-b", turnStillActive: true },
      ),
    ).toBe(true);
  });

  it("keeps appending when a null-turn segment resumes streaming", () => {
    expect(
      assistantSegmentStreamingTextResets(
        { role: "assistant", streaming: false, turnId: null },
        { streaming: true, turnId: null },
      ),
    ).toBe(false);
  });

  it("preserves completed text when the provider emits an empty completion", () => {
    expect(
      resolveAssistantSegmentText({ text: "Hello" }, { text: "", streaming: false }, false),
    ).toBe("Hello");
  });

  it("drops stale final assistant segments from an older turn", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-b",
        },
        incoming: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(["turn-a"]),
      }),
    ).toBe(true);
  });

  it("accepts forward rebound completions when the prior turn is not archived yet", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: false,
          turnId: "turn-b",
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(),
      }),
    ).toBe(false);
  });

  it("drops stale streaming assistant segments from an older turn", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-b",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: "turn-a",
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(["turn-a"]),
      }),
    ).toBe(true);
  });

  it("accepts forward rebound streaming when the prior turn is not archived yet", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-a",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: "turn-b",
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(),
      }),
    ).toBe(false);
  });

  it("drops null-turn stale chunks after an archived rebound settles", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-b",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: null,
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(["turn-a"]),
      }),
    ).toBe(true);
  });

  it("tracks archived replay rows with null turn ids", () => {
    const archivedTurnIds = archivedAssistantSegmentTurnIds(
      [
        {
          id: archivedAssistantSegmentMessageId("assistant-segment-0", null),
          turnId: null,
        },
      ],
      "assistant-segment-0",
    );

    expect(archivedTurnIds.has(null)).toBe(true);
  });

  it("drops stale null-turn chunks after an archived replay row", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: null,
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: null,
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set([null]),
      }),
    ).toBe(true);
  });

  it("accepts null-turn completed rows after an archived rebound settles", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: true,
          turnId: "turn-b",
        },
        incoming: {
          role: "assistant",
          streaming: false,
          turnId: null,
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(["turn-a"]),
      }),
    ).toBe(false);
  });

  it("accepts null-turn rebound chunks while a prompt is active", () => {
    expect(
      isLateAssistantSegmentFromPriorTurn({
        existing: {
          role: "assistant",
          streaming: false,
          turnId: "turn-b",
        },
        incoming: {
          role: "assistant",
          streaming: true,
          turnId: null,
        },
        providerMessageId: "assistant-segment-0",
        archivedTurnIds: new Set(["turn-a"]),
        turnStillActive: true,
      }),
    ).toBe(false);
  });

  it("archives completed replay rows on the first null-turn rebound chunk", () => {
    const result = applyAssistantSegmentMessageUpdate(
      [
        {
          id: "assistant-segment-0",
          role: "assistant",
          text: "Replayed response.",
          streaming: false,
          turnId: "turn-a",
          createdAt: "2026-06-24T00:29:27.101Z",
          updatedAt: "2026-06-24T00:29:27.101Z",
        },
      ],
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New ",
        streaming: true,
        turnId: null,
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
      { activeTurnId: "turn-b", turnStillActive: true },
    );

    expect(result.messages).toEqual([
      {
        id: archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
        role: "assistant",
        text: "Replayed response.",
        streaming: false,
        turnId: "turn-a",
        createdAt: "2026-06-24T00:29:27.101Z",
        updatedAt: "2026-06-24T00:29:27.101Z",
      },
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New ",
        streaming: true,
        turnId: null,
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    ]);
  });

  it("keeps same-active null-turn chunks on the existing assistant row", () => {
    const result = applyAssistantSegmentMessageUpdate(
      [
        {
          id: "assistant-segment-0",
          role: "assistant",
          text: "Still active.",
          streaming: false,
          turnId: "turn-a",
          createdAt: "2026-06-24T01:12:00.260Z",
          updatedAt: "2026-06-24T01:12:00.260Z",
        },
      ],
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: " More.",
        streaming: true,
        turnId: null,
        createdAt: "2026-06-24T01:12:01.000Z",
        updatedAt: "2026-06-24T01:12:01.000Z",
      },
      { activeTurnId: "turn-a", turnStillActive: true },
    );

    expect(result.messages).toEqual([
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "Still active. More.",
        streaming: true,
        turnId: null,
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:01.000Z",
      },
    ]);
  });

  it("drops stale null-turn chunks when another turn owns the active prompt", () => {
    const messages: AssistantSegmentThreadMessage[] = [
      {
        id: archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
        role: "assistant",
        text: "Archived response.",
        streaming: false,
        turnId: "turn-a",
        createdAt: "2026-06-24T00:29:27.101Z",
        updatedAt: "2026-06-24T00:29:27.101Z",
      },
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "Current response.",
        streaming: false,
        turnId: "turn-b",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    ];

    const result = applyAssistantSegmentMessageUpdate(
      messages,
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: " stale",
        streaming: true,
        turnId: null,
        createdAt: "2026-06-24T01:12:01.000Z",
        updatedAt: "2026-06-24T01:12:01.000Z",
      },
      { activeTurnId: "turn-c", turnStillActive: false },
    );

    expect(result.messages).toBe(messages);
  });

  it("archives prior-turn assistant rows when a reused segment rebinds via completion", () => {
    const result = applyAssistantSegmentMessageUpdate(
      [
        {
          id: "assistant-segment-0",
          role: "assistant",
          text: "Replayed response.",
          streaming: false,
          turnId: "turn-a",
          createdAt: "2026-06-24T00:29:27.101Z",
          updatedAt: "2026-06-24T00:29:27.101Z",
        },
      ],
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New completed response.",
        streaming: false,
        turnId: "turn-b",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    );

    expect(result.messages).toEqual([
      {
        id: archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
        role: "assistant",
        text: "Replayed response.",
        streaming: false,
        turnId: "turn-a",
        createdAt: "2026-06-24T00:29:27.101Z",
        updatedAt: "2026-06-24T00:29:27.101Z",
      },
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New completed response.",
        streaming: false,
        turnId: "turn-b",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    ]);
  });

  it("appends rebound live rows after newer messages", () => {
    const result = applyAssistantSegmentMessageUpdate(
      [
        {
          id: "assistant-segment-0",
          role: "assistant",
          text: "Replayed response.",
          streaming: false,
          turnId: "turn-a",
          createdAt: "2026-06-24T00:29:27.101Z",
          updatedAt: "2026-06-24T00:29:27.101Z",
        },
        {
          id: "user-follow-up",
          role: "user",
          text: "Next prompt",
          streaming: false,
          turnId: "turn-b",
          createdAt: "2026-06-24T01:11:59.000Z",
          updatedAt: "2026-06-24T01:11:59.000Z",
        },
      ],
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New response.",
        streaming: false,
        turnId: "turn-b",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    );

    expect(result.messages.map((message) => message.id)).toEqual([
      archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
      "user-follow-up",
      "assistant-segment-0",
    ]);
  });

  it("uses the replay occurrence when archiving null-turn completed rows", () => {
    const result = applyAssistantSegmentMessageUpdate(
      [
        {
          id: "assistant-segment-0",
          role: "assistant",
          text: "Null replay response.",
          streaming: false,
          turnId: null,
          createdAt: "2026-06-24T00:29:27.101Z",
          updatedAt: "2026-06-24T00:29:27.101Z",
        },
      ],
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New ",
        streaming: true,
        turnId: "turn-a",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    );

    expect(result.messages[0]?.id).toBe(
      archivedAssistantSegmentMessageId("assistant-segment-0", null, "2026-06-24T00:29:27.101Z"),
    );
    expect(result.messages[1]?.id).toBe("assistant-segment-0");
  });

  it("archives prior-turn assistant rows when a reused segment rebinds", () => {
    const result = applyAssistantSegmentMessageUpdate(
      [
        {
          id: "assistant-segment-0",
          role: "assistant",
          text: "Replayed response.",
          streaming: false,
          turnId: "turn-a",
          createdAt: "2026-06-24T00:29:27.101Z",
          updatedAt: "2026-06-24T00:29:27.101Z",
        },
      ],
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New ",
        streaming: true,
        turnId: "turn-b",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    );

    expect(result.messages).toEqual([
      {
        id: archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
        role: "assistant",
        text: "Replayed response.",
        streaming: false,
        turnId: "turn-a",
        createdAt: "2026-06-24T00:29:27.101Z",
        updatedAt: "2026-06-24T00:29:27.101Z",
      },
      {
        id: "assistant-segment-0",
        role: "assistant",
        text: "New ",
        streaming: true,
        turnId: "turn-b",
        createdAt: "2026-06-24T01:12:00.260Z",
        updatedAt: "2026-06-24T01:12:00.260Z",
      },
    ]);
    expect(result.checkpointsToRepoint).toEqual({
      providerMessageId: "assistant-segment-0",
      archivedMessageId: archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
      archivedTurnId: "turn-a",
    });
  });

  it("repoints checkpoint assistant message ids to the archived row", () => {
    const checkpoints = repointCheckpointsForArchivedAssistantSegment(
      [
        {
          turnId: "turn-a",
          assistantMessageId: "assistant-segment-0",
        },
      ],
      "assistant-segment-0",
      archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
      "turn-a",
    );

    expect(checkpoints[0]?.assistantMessageId).toBe(
      archivedAssistantSegmentMessageId("assistant-segment-0", "turn-a"),
    );
  });

  it("clears checkpoint assistant message ids when the archived row is not retained", () => {
    const checkpoints = repointCheckpointsForArchivedAssistantSegment(
      [
        {
          turnId: "turn-a",
          assistantMessageId: "assistant-segment-0",
        },
      ],
      "assistant-segment-0",
      null,
      "turn-a",
    );

    expect(checkpoints[0]?.assistantMessageId).toBeNull();
  });
});
