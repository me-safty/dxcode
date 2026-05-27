import { describe, expect, it } from "vitest";

import { buildTicketSidebarPinnedItem } from "~/t3work/t3work-sidebarPinningTypes";
import type { ProjectThread, ProjectTicket } from "~/t3work/t3work-types";
import { resolveProjectSidebarPinnedItems } from "./t3work-useProjectSidebarPinnedItems";

function createTicket(): ProjectTicket {
  return {
    id: "ticket-1",
    projectId: "project-1",
    ref: {
      provider: "jira",
      kind: "issue",
      id: "10001",
      displayId: "PROJ-1",
      title: "Investigate pinned activity behavior",
      url: "https://example.test/PROJ-1",
      projectId: "project-1",
    },
    status: "In Progress",
    updatedAt: "2026-05-26T12:00:00.000Z",
  };
}

function createThread(overrides?: Partial<ProjectThread>): ProjectThread {
  return {
    id: "thread-1",
    projectId: "project-1",
    ticketId: "ticket-1",
    ticketDisplayId: "PROJ-1",
    title: "Investigate pinned activity behavior",
    status: "idle",
    lastMessageAt: "2026-05-26T12:00:00.000Z",
    messageCount: 2,
    createdAt: "2026-05-26T11:00:00.000Z",
    ...overrides,
  };
}

describe("resolveProjectSidebarPinnedItems", () => {
  it("does not surface ticket-backed session threads without an explicit pin", () => {
    const ticket = createTicket();
    const thread = createThread();

    const resolvedItems = resolveProjectSidebarPinnedItems({
      projectId: "project-1",
      pinnedSidebarItems: [],
      ticketLookup: new Map([[ticket.id, ticket]]),
      ticketThreadsById: new Map([
        [
          ticket.id,
          {
            ticketId: ticket.id,
            ticketDisplayId: ticket.ref.displayId,
            title: thread.title,
            ticketThreads: [thread],
          },
        ],
      ]),
      githubActivityById: new Map(),
    });

    expect(resolvedItems).toEqual([]);
  });

  it("does not duplicate explicit Jira pins that already have ticket-backed session threads", () => {
    const ticket = createTicket();
    const thread = createThread({ id: "thread-2", lastMessageAt: "2026-05-26T13:00:00.000Z" });
    const explicitPin = buildTicketSidebarPinnedItem({
      projectId: "project-1",
      ticketId: ticket.id,
      pinnedAt: "2026-05-26T10:00:00.000Z",
    });

    const resolvedItems = resolveProjectSidebarPinnedItems({
      projectId: "project-1",
      pinnedSidebarItems: [explicitPin],
      ticketLookup: new Map([[ticket.id, ticket]]),
      ticketThreadsById: new Map([
        [
          ticket.id,
          {
            ticketId: ticket.id,
            ticketDisplayId: ticket.ref.displayId,
            title: thread.title,
            ticketThreads: [thread],
          },
        ],
      ]),
      githubActivityById: new Map(),
    });

    expect(resolvedItems).toEqual([
      {
        kind: "jira-work-item",
        pinnedItem: explicitPin,
        ticket,
        ticketThreads: [thread],
      },
    ]);
  });
});
