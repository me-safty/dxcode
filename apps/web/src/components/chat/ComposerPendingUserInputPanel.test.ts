import { ApprovalRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSingleSelectPendingUserInputAnswers } from "./ComposerPendingUserInputPanel";
import type { PendingUserInput } from "../../session-logic";

describe("buildSingleSelectPendingUserInputAnswers", () => {
  it("builds a submit-ready answer map from the clicked single-select option", () => {
    const prompt: PendingUserInput = {
      requestId: ApprovalRequestId.make("req-user-input-1"),
      createdAt: "2026-07-08T21:40:00.000Z",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Which scope?",
          options: [
            { label: "Workspace", description: "Use workspace context" },
            { label: "Session", description: "Use current session only" },
          ],
          required: true,
          multiSelect: false,
        },
      ],
    };

    expect(
      buildSingleSelectPendingUserInputAnswers({
        prompt,
        answers: {},
        questionId: "scope",
        optionLabel: "Workspace",
      }),
    ).toEqual({ scope: "Workspace" });
  });

  it("preserves earlier answers when submitting the last question", () => {
    const prompt: PendingUserInput = {
      requestId: ApprovalRequestId.make("req-user-input-2"),
      createdAt: "2026-07-08T21:40:00.000Z",
      questions: [
        {
          id: "area",
          header: "Area",
          question: "Which area?",
          options: [{ label: "Server", description: "Server code" }],
          required: true,
          multiSelect: false,
        },
        {
          id: "scope",
          header: "Scope",
          question: "Which scope?",
          options: [{ label: "Workspace", description: "Use workspace context" }],
          required: true,
          multiSelect: false,
        },
      ],
    };

    expect(
      buildSingleSelectPendingUserInputAnswers({
        prompt,
        answers: {
          area: {
            customAnswer: "",
            selectedOptionLabels: ["Server"],
          },
        },
        questionId: "scope",
        optionLabel: "Workspace",
      }),
    ).toEqual({ area: "Server", scope: "Workspace" });
  });
});
