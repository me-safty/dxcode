import { describe, expect, it } from "vitest";

import { shouldShowThreadKickoffPlaceholder } from "~/t3work/chat/t3work-threadKickoffPlaceholder";

describe("shouldShowThreadKickoffPlaceholder", () => {
  it("shows when a kickoff message exists and no live messages are present", () => {
    expect(
      shouldShowThreadKickoffPlaceholder({
        kickoffMessage: "Review the ticket and propose a plan.",
        serverMessageCount: 0,
      }),
    ).toBe(true);
  });

  it("shows before the live thread shell exists", () => {
    expect(
      shouldShowThreadKickoffPlaceholder({
        kickoffMessage: "Review the ticket and propose a plan.",
        serverMessageCount: null,
      }),
    ).toBe(true);
  });

  it("hides once the live thread has messages", () => {
    expect(
      shouldShowThreadKickoffPlaceholder({
        kickoffMessage: "Review the ticket and propose a plan.",
        serverMessageCount: 1,
      }),
    ).toBe(false);
  });

  it("hides when there is no kickoff message", () => {
    expect(
      shouldShowThreadKickoffPlaceholder({
        kickoffMessage: undefined,
        serverMessageCount: 0,
      }),
    ).toBe(false);
  });
});
