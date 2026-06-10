import { describe, expect, it } from "vite-plus/test";

import { createProjectBacklogTestTicket as createTicket } from "./t3work-projectBacklogTestUtils";
import { getProjectBacklogTableRowEstimateBaseline } from "./t3work-useProjectBacklogTableRowDraft";

describe("project backlog table row draft", () => {
  it("uses tracked hours as the estimate baseline when a subtask has no numeric estimate", () => {
    const ticket = createTicket({
      id: "subtask",
      issueType: "Task",
      issueTypeIsSubtask: true,
      timeOriginalEstimateSeconds: 86400,
    });

    expect(getProjectBacklogTableRowEstimateBaseline(ticket)).toBe("24");
  });
});
