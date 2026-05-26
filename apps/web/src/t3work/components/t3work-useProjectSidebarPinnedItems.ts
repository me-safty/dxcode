import { useMemo } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { T3WorkSidebarPinnedItem } from "~/t3work/t3work-sidebarPinningTypes";
import { buildProjectTicketLookup } from "~/t3work/t3work-ticketLookup";
import type { ProjectThread, ProjectTicket } from "~/t3work/t3work-types";
import { buildPinnedTicketThreadFallbacks } from "./t3work-projectSidebarItemState";

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

  return useMemo<ResolvedPinnedSidebarItem[]>(() => {
    const resolvedItems: ResolvedPinnedSidebarItem[] = [];

    for (const pinnedItem of pinnedSidebarItems) {
      if (pinnedItem.projectId !== project.id) {
        continue;
      }

      if (pinnedItem.kind === "jira-work-item") {
        const ticket = ticketLookup.get(pinnedItem.ticketId);
        const ticketThreads = ticketThreadsById.get(pinnedItem.ticketId)?.ticketThreads ?? [];
        if (ticket) {
          resolvedItems.push({ kind: "jira-work-item", pinnedItem, ticket, ticketThreads });
          continue;
        }

        const fallback = ticketThreadsById.get(pinnedItem.ticketId);
        if (fallback) {
          resolvedItems.push({
            kind: "jira-work-item-unresolved",
            pinnedItem,
            ticketId: fallback.ticketId,
            ticketDisplayId: fallback.ticketDisplayId,
            title: fallback.title,
            ticketThreads: fallback.ticketThreads,
          });
        }
        continue;
      }

      const githubActivity = githubActivityById.get(pinnedItem.activityId);
      if (githubActivity) {
        resolvedItems.push({
          kind: "github-activity",
          pinnedItem,
          item: githubActivity.item,
          linkedWorkItem: githubActivity.linkedWorkItem,
        });
      }
    }

    return resolvedItems;
  }, [githubActivityById, pinnedSidebarItems, project.id, ticketLookup, ticketThreadsById]);
}
