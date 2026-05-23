import { useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { useBackend } from "~/t3work/backend/t3work-index";
import { useAgentContext } from "~/t3work/hooks/t3work-useAgentContext";
import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import {
  buildGitHubActivitySidebarPinnedItem,
  buildTicketSidebarPinnedItem,
} from "~/t3work/t3work-sidebarPinningTypes";
import {
  buildGitHubActivityAgentContextCapabilities,
  buildTicketAgentContextCapabilities,
} from "~/t3work/t3work-ticketAgentContext";
import type { ProjectTicket } from "~/t3work/t3work-types";

const emptyGitHubActivityByWorkItem = new Map<string, readonly GitHubWorkActivityItem[]>();

export function useTicketAgentContext(input: {
  project: ProjectShellProject;
  projectTickets: ReadonlyArray<ProjectTicket>;
  githubActivityByWorkItem?: ReadonlyMap<string, ReadonlyArray<GitHubWorkActivityItem>>;
}) {
  const {
    project,
    projectTickets,
    githubActivityByWorkItem = emptyGitHubActivityByWorkItem,
  } = input;
  const backend = useBackend();
  const { showAgentContextMenu, showAgentContextMenuAt } = useAgentContext();
  const pinnedSidebarItems = useT3WorkPinnedSidebarStore((state) => state.items);
  const pinnedItemIds = useMemo(
    () => new Set(pinnedSidebarItems.map((item) => item.id)),
    [pinnedSidebarItems],
  );

  const getTicketAgentContext = useCallback(
    (ticket: ProjectTicket, options?: { visibleInSidebar?: boolean }) => {
      if (!backend) {
        return null;
      }

      const sidebarPinItem = buildTicketSidebarPinnedItem({
        projectId: project.id,
        ticketId: ticket.id,
      });

      return buildTicketAgentContextCapabilities(
        {
          backend,
          project,
          ticket,
          projectTickets,
          githubActivityItems: githubActivityByWorkItem.get(ticket.ref.displayId) ?? [],
        },
        {
          sidebarPin: {
            item: sidebarPinItem,
            pinned: pinnedItemIds.has(sidebarPinItem.id),
            ...(options?.visibleInSidebar ? { visibleInSidebar: true } : {}),
          },
        },
      );
    },
    [backend, githubActivityByWorkItem, pinnedItemIds, project, projectTickets],
  );

  const getGitHubActivityAgentContext = useCallback(
    (
      ticket: ProjectTicket | null,
      item: GitHubWorkActivityItem,
      options?: { fallbackHost?: string; visibleInSidebar?: boolean },
    ) => {
      const sidebarPinItem = buildGitHubActivitySidebarPinnedItem({
        projectId: project.id,
        activityId: item.id,
      });

      return buildGitHubActivityAgentContextCapabilities(
        {
          backend,
          project,
          item,
          linkedWorkItem: ticket,
          ...(ticket
            ? {
                projectTickets,
                githubActivityItems: githubActivityByWorkItem.get(ticket.ref.displayId) ?? [],
              }
            : {}),
          ...(options?.fallbackHost ? { fallbackHost: options.fallbackHost } : {}),
        },
        {
          sidebarPin: {
            item: sidebarPinItem,
            pinned: pinnedItemIds.has(sidebarPinItem.id),
            ...(options?.visibleInSidebar ? { visibleInSidebar: true } : {}),
          },
        },
      );
    },
    [backend, githubActivityByWorkItem, pinnedItemIds, project, projectTickets],
  );

  const openTicketAgentContextMenu = useCallback(
    (event: MouseEvent, ticket: ProjectTicket, options?: { visibleInSidebar?: boolean }) => {
      const capabilities = getTicketAgentContext(ticket, options);
      if (!capabilities) {
        return;
      }

      void showAgentContextMenu(event, capabilities);
    },
    [getTicketAgentContext, showAgentContextMenu],
  );

  const openTicketAgentContextMenuAt = useCallback(
    (ticket: ProjectTicket, x: number, y: number, options?: { visibleInSidebar?: boolean }) => {
      const capabilities = getTicketAgentContext(ticket, options);
      if (!capabilities) {
        return;
      }

      void showAgentContextMenuAt({ capabilities, x, y });
    },
    [getTicketAgentContext, showAgentContextMenuAt],
  );

  const openGitHubActivityAgentContextMenu = useCallback(
    (
      event: MouseEvent,
      ticket: ProjectTicket | null,
      item: GitHubWorkActivityItem,
      options?: { fallbackHost?: string; visibleInSidebar?: boolean },
    ) => {
      void showAgentContextMenu(event, getGitHubActivityAgentContext(ticket, item, options));
    },
    [getGitHubActivityAgentContext, showAgentContextMenu],
  );

  return {
    getTicketAgentContext,
    getGitHubActivityAgentContext,
    openTicketAgentContextMenu,
    openTicketAgentContextMenuAt,
    openGitHubActivityAgentContextMenu,
  };
}
