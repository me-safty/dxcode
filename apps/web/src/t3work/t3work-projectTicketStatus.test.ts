import { describe, expect, it } from "vitest";

import { createProjectBacklogTestTicket as createTicket } from "./t3work-projectBacklogTestUtils";
import {
  buildProjectTicketKanbanColumns,
  getProjectTicketKanbanColumnId,
  getProjectTicketKanbanLane,
  isProjectTicketKanbanStatusVisibleForProfile,
  matchesProjectTicketStatusCategory,
} from "./t3work-projectTicketStatus";

describe("project ticket status", () => {
  it("maps custom Jira workflow names into canonical kanban lanes", () => {
    expect(getProjectTicketKanbanLane("Selected for Development")).toBe("todo");
    expect(getProjectTicketKanbanLane("Accepted")).toBe("inProgress");
    expect(getProjectTicketKanbanLane("Blocked")).toBe("inProgress");
    expect(getProjectTicketKanbanLane("In Test")).toBe("review");
    expect(getProjectTicketKanbanLane("Ready for Review")).toBe("review");
    expect(getProjectTicketKanbanLane("Cancelled")).toBe("done");
  });

  it("treats todo and in-progress lanes as active work", () => {
    expect(matchesProjectTicketStatusCategory("Selected for Development", "active")).toBe(true);
    expect(matchesProjectTicketStatusCategory("Blocked", "active")).toBe(true);
    expect(matchesProjectTicketStatusCategory("In QA", "review")).toBe(true);
    expect(matchesProjectTicketStatusCategory("Resolved", "done")).toBe(true);
  });

  it("builds exact Jira status columns without a fallback other bucket", () => {
    const columns = buildProjectTicketKanbanColumns([
      createTicket({ id: "todo-a", status: "To Do" }),
      createTicket({ id: "todo-b", status: "To Do" }),
      createTicket({ id: "accepted", status: "Accepted" }),
      createTicket({ id: "in-test", status: "In Test" }),
      createTicket({ id: "done", status: "Cancelled" }),
    ]);

    expect(columns.map((column) => column.title)).toEqual([
      "To Do",
      "Accepted",
      "In Test",
      "Cancelled",
    ]);
    expect(columns.map((column) => column.id)).toEqual([
      getProjectTicketKanbanColumnId("To Do"),
      getProjectTicketKanbanColumnId("Accepted"),
      getProjectTicketKanbanColumnId("In Test"),
      getProjectTicketKanbanColumnId("Cancelled"),
    ]);
    expect(columns[0]?.items.map((ticket) => ticket.id)).toEqual(["todo-a", "todo-b"]);
  });

  it("uses official Jira board order and hides statuses outside the board", () => {
    const columns = buildProjectTicketKanbanColumns(
      [
        createTicket({ id: "todo", status: "To Do" }),
        createTicket({ id: "accepted", status: "Accepted" }),
        createTicket({ id: "in-test", status: "In Test" }),
        createTicket({ id: "cancelled", status: "Cancelled" }),
      ],
      {
        boardColumns: [
          { name: "To Do", statuses: [{ name: "To Do" }] },
          { name: "Testing", statuses: [{ name: "In Test" }] },
          { name: "Done", statuses: [{ name: "Cancelled" }] },
        ],
      },
    );

    expect(columns.map((column) => column.title)).toEqual(["To Do", "In Test", "Cancelled"]);
  });

  it("hides requirements-only statuses for non-RE kanban profiles", () => {
    expect(isProjectTicketKanbanStatusVisibleForProfile("Accepted", "requirements-engineer")).toBe(
      true,
    );
    expect(isProjectTicketKanbanStatusVisibleForProfile("Accepted", "developer")).toBe(false);
    expect(isProjectTicketKanbanStatusVisibleForProfile("Accepted", "test-engineer")).toBe(false);
    expect(isProjectTicketKanbanStatusVisibleForProfile("In Test", "developer")).toBe(true);

    const developerColumns = buildProjectTicketKanbanColumns(
      [
        createTicket({ id: "todo", status: "To Do" }),
        createTicket({ id: "accepted", status: "Accepted" }),
        createTicket({ id: "in-test", status: "In Test" }),
      ],
      { profileId: "developer" },
    );
    const requirementsEngineerColumns = buildProjectTicketKanbanColumns(
      [
        createTicket({ id: "todo", status: "To Do" }),
        createTicket({ id: "accepted", status: "Accepted" }),
        createTicket({ id: "in-test", status: "In Test" }),
      ],
      { profileId: "requirements-engineer" },
    );

    expect(developerColumns.map((column) => column.title)).toEqual(["To Do", "In Test"]);
    expect(requirementsEngineerColumns.map((column) => column.title)).toEqual([
      "To Do",
      "Accepted",
      "In Test",
    ]);
  });
});
