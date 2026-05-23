import { describe, expect, it } from "vitest";

import { buildAddToChatAgentContextCapabilities } from "~/t3work/t3work-agentContext";
import type { AddToChatRequest } from "~/t3work/t3work-addToChatUtils";
import type { T3WorkSidebarPinnedItem } from "~/t3work/t3work-sidebarPinningTypes";

function createRequest(): AddToChatRequest {
  return {
    projectId: "project-1",
    projectTitle: "Alpha",
    targetLabel: "PROJ-9 Prepare release checklist",
    targetType: "work-item",
    kind: "jira-work-item",
    payload: { id: "PROJ-9" },
  };
}

function createPinnedTicket(): T3WorkSidebarPinnedItem {
  return {
    id: "project-1:jira-work-item:ticket-9",
    kind: "jira-work-item",
    projectId: "project-1",
    ticketId: "ticket-9",
    pinnedAt: "2026-05-23T12:00:00.000Z",
  };
}

describe("buildAddToChatAgentContextCapabilities", () => {
  it("wraps an add-to-chat request as a reusable agent context action", () => {
    const request = createRequest();
    const capabilities = buildAddToChatAgentContextCapabilities(request);

    expect(capabilities.tools).toBeUndefined();
    expect(capabilities.actions).toEqual([
      {
        id: "add-to-chat",
        label: "Add to chat",
        kind: "add-to-chat",
        request,
      },
    ]);
  });

  it("can append a pin-to-left action for unpinned sidebar items", () => {
    const request = createRequest();
    const pinnedItem = createPinnedTicket();

    const capabilities = buildAddToChatAgentContextCapabilities(request, {
      sidebarPin: {
        item: pinnedItem,
        pinned: false,
      },
    });

    expect(capabilities.actions).toEqual([
      {
        id: "add-to-chat",
        label: "Add to chat",
        kind: "add-to-chat",
        request,
      },
      {
        id: "pin-to-left",
        label: "Pin to left",
        kind: "pin-to-sidebar",
        item: pinnedItem,
      },
    ]);
  });

  it("can append an unpin action for sidebar-visible items that are not explicitly pinned", () => {
    const request = createRequest();
    const pinnedItem = createPinnedTicket();

    const capabilities = buildAddToChatAgentContextCapabilities(request, {
      sidebarPin: {
        item: pinnedItem,
        pinned: false,
        visibleInSidebar: true,
      },
    });

    expect(capabilities.actions).toEqual([
      {
        id: "add-to-chat",
        label: "Add to chat",
        kind: "add-to-chat",
        request,
      },
      {
        id: "unpin",
        label: "Unpin",
        kind: "unpin-from-sidebar",
        item: pinnedItem,
      },
    ]);
  });

  it("can append an unpin action for pinned sidebar items", () => {
    const request = createRequest();
    const pinnedItem = createPinnedTicket();

    const capabilities = buildAddToChatAgentContextCapabilities(request, {
      sidebarPin: {
        item: pinnedItem,
        pinned: true,
      },
    });

    expect(capabilities.actions).toEqual([
      {
        id: "add-to-chat",
        label: "Add to chat",
        kind: "add-to-chat",
        request,
      },
      {
        id: "unpin",
        label: "Unpin",
        kind: "unpin-from-sidebar",
        item: pinnedItem,
      },
    ]);
  });
});
