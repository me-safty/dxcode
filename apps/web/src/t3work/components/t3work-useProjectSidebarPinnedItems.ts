import { useMemo } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import {
  buildTicketSidebarPinnedItem,
  type T3WorkSidebarPinnedItem,
} from "~/t3work/t3work-sidebarPinningTypes";
import { buildProjectTicketLookup } from "~/t3work/t3work-ticketLookup";
import type { ProjectThread, ProjectTicket } from "~/t3work/t3work-types";
import {
  buildPinnedTicketThreadFallbacks,
  type SidebarPinnedTicketThreadFallback,
} from "./t3work-projectSidebarItemState";

export type ResolvedPinnedSidebarItem =
  | {
      kind: "jira-work-item";
      pinnedItem: Extract<T3WorkSidebarPinnedItem, { kind: "jira-work-item" }>;
      ticket: ProjectTicket;
      ticketThreads: readonly ProjectThread[];
    }
  | {
      kind: "jira-work-item-unresolved";
      pinnedItem: Extract<T3WorkSidebarPinnedItem, { kind: "jira-work-item" }>;
      ticketId: string;
      ticketDisplayId: string;
      title: string;
      ticketThreads: readonly ProjectThread[];
    }
  | {
      kind: "github-activity";
      pinnedItem: Extract<T3WorkSidebarPinnedItem, { kind: "github-activity" }>;
      item: GitHubWorkActivityItem;
      linkedWorkItem: ProjectTicket | null;
    };

type ResolvedGitHubActivityById = ReadonlyMap<
  string,
  { item: GitHubWorkActivityItem; linkedWorkItem: ProjectTicket | null }
>;

export function resolveProjectSidebarPinnedItems(input: {
  projectId: string;
  pinnedSidebarItems: ReadonlyArray<T3WorkSidebarPinnedItem>;
  ticketLookup: ReadonlyMap<string, ProjectTicket>;
  ticketThreadsById: ReadonlyMap<string, SidebarPinnedTicketThreadFallback>;
  githubActivityById: ResolvedGitHubActivityById;
}): ResolvedPinnedSidebarItem[] {
  const resolvedItems: ResolvedPinnedSidebarItem[] = [];
  const resolvedPinnedItemIds = new Set<string>();

  for (const pinnedItem of input.pinnedSidebarItems) {
    if (pinnedItem.projectId !== input.projectId) {
      continue;
    }

    if (pinnedItem.kind === "jira-work-item") {
      const ticket = input.ticketLookup.get(pinnedItem.ticketId);
      const ticketThreads = input.ticketThreadsById.get(pinnedItem.ticketId)?.ticketThreads ?? [];
      if (ticket) {
        resolvedItems.push({ kind: "jira-work-item", pinnedItem, ticket, ticketThreads });
        resolvedPinnedItemIds.add(pinnedItem.id);
        continue;
      }

      const fallback = input.ticketThreadsById.get(pinnedItem.ticketId);
      if (fallback) {
        resolvedItems.push({
          kind: "jira-work-item-unresolved",
          pinnedItem,
          ticketId: fallback.ticketId,
          ticketDisplayId: fallback.ticketDisplayId,
          title: fallback.title,
          ticketThreads: fallback.ticketThreads,
        });
        resolvedPinnedItemIds.add(pinnedItem.id);
      }
      continue;
    }

    const githubActivity = input.githubActivityById.get(pinnedItem.activityId);
    if (githubActivity) {
      resolvedItems.push({
        kind: "github-activity",
        pinnedItem,
        item: githubActivity.item,
        linkedWorkItem: githubActivity.linkedWorkItem,
      });
      resolvedPinnedItemIds.add(pinnedItem.id);
    }
  }

  return resolvedItems;
}

export function useProjectSidebarPinnedItems(input: {
  project: ProjectShellProject;
  projectTickets: ReadonlyArray<ProjectTicket>;
  projectThreads: ReadonlyArray<ProjectThread>;
  githubActivityByWorkItem: ReadonlyMap<string, ReadonlyArray<GitHubWorkActivityItem>>;
  unlinkedGitHubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
}) {
  const {
    project,
    projectTickets,
    projectThreads,
    githubActivityByWorkItem,
    unlinkedGitHubActivityItems,
  } = input;
  const pinnedSidebarItems = useT3WorkPinnedSidebarStore((state) => state.items);

  const ticketLookup = useMemo(() => buildProjectTicketLookup(projectTickets), [projectTickets]);
  const ticketThreadsById = useMemo(
    () => buildPinnedTicketThreadFallbacks(projectThreads, ticketLookup),
    [projectThreads, ticketLookup],
  );
  const githubActivityById = useMemo(() => {
    const resolvedItems = new Map<
      string,
      { item: GitHubWorkActivityItem; linkedWorkItem: ProjectTicket | null }
    >();

    for (const item of unlinkedGitHubActivityItems) {
      resolvedItems.set(item.id, { item, linkedWorkItem: null });
    }

    for (const ticket of projectTickets) {
      for (const item of githubActivityByWorkItem.get(ticket.ref.displayId) ?? []) {
        resolvedItems.set(item.id, { item, linkedWorkItem: ticket });
      }
    }

    return resolvedItems;
  }, [githubActivityByWorkItem, projectTickets, unlinkedGitHubActivityItems]);

  return useMemo<ResolvedPinnedSidebarItem[]>(
    () =>
      resolveProjectSidebarPinnedItems({
        projectId: project.id,
        pinnedSidebarItems,
        ticketLookup,
        ticketThreadsById,
        githubActivityById,
      }),
    [githubActivityById, pinnedSidebarItems, project.id, ticketLookup, ticketThreadsById],
  );
}
