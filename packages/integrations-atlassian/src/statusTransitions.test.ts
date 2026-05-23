import { describe, expect, it } from "vitest";

import { selectJiraIssueTransitionForStatus } from "./statusTransitions.ts";

describe("status transitions", () => {
  it("matches transitions by exact destination status name", () => {
    const transition = selectJiraIssueTransitionForStatus(
      [
        {
          id: "11",
          name: "Start progress",
          to: { name: "In Development", statusCategory: { key: "indeterminate" } },
        },
        {
          id: "12",
          name: "Send to review",
          to: { name: "Ready for Review", statusCategory: { key: "indeterminate" } },
        },
      ],
      "Ready for Review",
    );

    expect(transition?.id).toBe("12");
  });

  it("falls back to exact transition names when Jira omits the destination status", () => {
    const transition = selectJiraIssueTransitionForStatus(
      [
        {
          id: "21",
          name: "Resolve",
        },
      ],
      "Resolve",
    );

    expect(transition?.id).toBe("21");
  });

  it("returns undefined when no transition fits the requested status", () => {
    const transition = selectJiraIssueTransitionForStatus(
      [
        {
          id: "31",
          name: "Close issue",
          to: { name: "Done", statusCategory: { key: "done" } },
        },
      ],
      "Blocked",
    );

    expect(transition).toBeUndefined();
  });
});
