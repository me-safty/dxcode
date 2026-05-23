import { describe, expect, it } from "vitest";

import { deriveTicketVisibility } from "./t3work-projectSidebarProjectRow.helpers";
import type { ProjectTicket } from "~/t3work/t3work-types";
import { buildTicketSidebarPinnedItemId } from "~/t3work/t3work-sidebarPinningTypes";

function createTicket(id: string, parentId?: string): ProjectTicket {
  return {
    id,
    projectId: "project-1",
    ...(parentId ? { parentId } : {}),
    ref: {
      provider: "jira",
      kind: "issue",
      id,
      displayId: id.toUpperCase(),
      title: `Ticket ${id}`,
      url: `https://example.test/${id}`,
      projectId: "project-1",
    },
    status: "In Progress",
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

describe("deriveTicketVisibility", () => {
  it("applies stored Jira sidebar ids before truncating the flat list", () => {
    const tickets = ["a", "b", "c", "d", "e", "f"].map((id) => createTicket(id));

    const visibility = deriveTicketVisibility({
      projectId: "project-1",
      projectTickets: tickets,
      ticketHierarchy: {
        roots: tickets,
        unresolvedChildren: [],
        childrenByParentId: new Map(),
      },
      ticketViewMode: "flat",
      hiddenItemIds: [buildTicketSidebarPinnedItemId({ projectId: "project-1", ticketId: "a" })],
      orderedItemIds: [
        buildTicketSidebarPinnedItemId({ projectId: "project-1", ticketId: "f" }),
        buildTicketSidebarPinnedItemId({ projectId: "project-1", ticketId: "c" }),
      ],
    });

    expect(visibility.visibleFlatTickets.map((ticket) => ticket.id)).toEqual([
      "f",
      "c",
      "b",
      "d",
      "e",
    ]);
    expect(visibility.hiddenTicketCount).toBe(1);
  });

  it("fills tree slots from unresolved Jira items after hidden roots are removed", () => {
    const rootA = createTicket("root-a");
    const rootB = createTicket("root-b");
    const unresolved = ["u1", "u2", "u3", "u4"].map((id) => createTicket(id));
    const tickets = [rootA, rootB, ...unresolved];

    const visibility = deriveTicketVisibility({
      projectId: "project-1",
      projectTickets: tickets,
      ticketHierarchy: {
        roots: [rootA, rootB],
        unresolvedChildren: unresolved,
        childrenByParentId: new Map(),
      },
      ticketViewMode: "tree",
      hiddenItemIds: [
        buildTicketSidebarPinnedItemId({ projectId: "project-1", ticketId: "root-b" }),
      ],
      orderedItemIds: [
        buildTicketSidebarPinnedItemId({ projectId: "project-1", ticketId: "u3" }),
        buildTicketSidebarPinnedItemId({ projectId: "project-1", ticketId: "u1" }),
      ],
    });

    expect(visibility.visibleTreeRoots.map((ticket) => ticket.id)).toEqual(["root-a"]);
    expect(visibility.visibleTreeUnresolvedChildren.map((ticket) => ticket.id)).toEqual([
      "u3",
      "u1",
      "u2",
      "u4",
    ]);
    expect(visibility.hiddenTicketCount).toBe(1);
  });
});
