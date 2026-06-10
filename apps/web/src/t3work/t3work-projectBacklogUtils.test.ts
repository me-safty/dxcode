import { describe, expect, it } from "vite-plus/test";
import {
  buildProjectBacklogAssigneeFilterOptions,
  filterProjectBacklogTickets,
  isProjectTicketHourTracked,
  isProjectTicketSubtask,
  resolveProjectBacklogAssigneeFilter,
  summarizeProjectBacklog,
} from "./t3work-projectBacklogUtils";
import { createProjectBacklogTestTicket as createTicket } from "./t3work-projectBacklogTestUtils";

describe("project backlog utils", () => {
  it("prioritizes unestimated and unassigned tickets in the filtered backlog", () => {
    const planned = createTicket({ id: "planned", assignee: "Alex", estimateValue: 3 });
    const needsPlan = createTicket({ id: "needs-plan" });

    expect(
      filterProjectBacklogTickets({
        tickets: [planned, needsPlan],
        query: "",
        focusFilter: "all",
      }).map((ticket) => ticket.id),
    ).toEqual(["needs-plan", "planned"]);
  });

  it("supports focused backlog slices and metrics", () => {
    const tickets = [
      createTicket({ id: "unassigned" }),
      createTicket({ id: "estimated", assignee: "Alex", estimateValue: 2, subtaskCount: 2 }),
    ];

    expect(
      filterProjectBacklogTickets({
        tickets,
        query: "",
        focusFilter: "with-subtasks",
      }).map((ticket) => ticket.id),
    ).toEqual(["estimated"]);

    expect(summarizeProjectBacklog(tickets)).toEqual({
      total: 2,
      needsPlan: 1,
      unassigned: 1,
      needsEstimate: 1,
      ready: 1,
      withSubtasks: 1,
    });
  });

  it("recognizes subtask issue types", () => {
    expect(isProjectTicketSubtask(createTicket({ id: "subtask", issueType: "Sub-task" }))).toBe(
      true,
    );
    expect(
      isProjectTicketSubtask(createTicket({ id: "custom-subtask", issueTypeIsSubtask: true })),
    ).toBe(true);
  });

  it("treats bugs and subtasks as hour-tracked work", () => {
    expect(isProjectTicketHourTracked(createTicket({ id: "bug", issueType: "Bug" }))).toBe(true);
    expect(isProjectTicketHourTracked(createTicket({ id: "subtask", issueType: "Sub-task" }))).toBe(
      true,
    );
    expect(
      isProjectTicketHourTracked(
        createTicket({ id: "tracked", timeOriginalEstimateSeconds: 3600 }),
      ),
    ).toBe(true);
    expect(
      isProjectTicketHourTracked(
        createTicket({ id: "story", issueType: "Story", timeOriginalEstimateSeconds: 3600 }),
      ),
    ).toBe(false);
    expect(isProjectTicketHourTracked(createTicket({ id: "story", issueType: "Story" }))).toBe(
      false,
    );
  });

  it("matches backlog search against descriptions", () => {
    const tickets = [
      createTicket({ id: "alpha", description: "Coordinate release planning notes" }),
      createTicket({ id: "beta", description: "Backfill analytics tracking" }),
    ];

    expect(
      filterProjectBacklogTickets({
        tickets,
        query: "release planning",
        focusFilter: "all",
      }).map((ticket) => ticket.id),
    ).toEqual(["alpha"]);
  });

  it("matches backlog search against ancestor keys and titles", () => {
    const epic = createTicket({
      id: "epic",
      issueType: "Epic",
      ref: { displayId: "PROJ-10", title: "Checkout Revamp" },
    });
    const story = createTicket({
      id: "story",
      issueType: "Story",
      parentId: epic.id,
      ref: { displayId: "PROJ-11", title: "Improve cart summary" },
    });
    const subtask = createTicket({
      id: "subtask",
      issueType: "Sub-task",
      parentId: story.id,
      ref: { displayId: "PROJ-12", title: "Hook up CTA" },
    });

    expect(
      filterProjectBacklogTickets({
        tickets: [epic, story, subtask],
        query: "checkout revamp",
        focusFilter: "all",
      }).map((ticket) => ticket.id),
    ).toEqual(["epic", "story", "subtask"]);
    expect(
      filterProjectBacklogTickets({
        tickets: [epic, story, subtask],
        query: "PROJ-10",
        focusFilter: "all",
      }).map((ticket) => ticket.id),
    ).toEqual(["epic", "story", "subtask"]);
  });

  it("puts the preferred assignee first in filter options", () => {
    const tickets = [
      createTicket({ id: "alpha", assignee: "Alex", assigneeAccountId: "account-alex" }),
      createTicket({ id: "pj", assignee: "Philip Jonientz", assigneeAccountId: "account-pj" }),
      createTicket({ id: "zoe", assignee: "Zoe", assigneeAccountId: "account-zoe" }),
    ];

    expect(
      buildProjectBacklogAssigneeFilterOptions(tickets, "Philip Jonientz").map(
        (option) => option.label,
      ),
    ).toEqual(["All assignees", "Philip Jonientz", "Alex", "Zoe"]);
  });

  it("treats unavailable assignee filters as all assignees", () => {
    const tickets = [
      createTicket({ id: "alpha", assignee: "Alex", assigneeAccountId: "account-alex" }),
      createTicket({ id: "zoe", assignee: "Zoe", assigneeAccountId: "account-zoe" }),
    ];

    expect(resolveProjectBacklogAssigneeFilter(tickets, "account:stale-user")).toBe("__all__");
    expect(resolveProjectBacklogAssigneeFilter(tickets, "account:account-alex")).toBe(
      "account:account-alex",
    );
    expect(
      filterProjectBacklogTickets({
        tickets,
        query: "",
        focusFilter: "all",
        assigneeFilter: "account:stale-user",
      }).map((ticket) => ticket.id),
    ).toEqual(["alpha", "zoe"]);
  });
});
