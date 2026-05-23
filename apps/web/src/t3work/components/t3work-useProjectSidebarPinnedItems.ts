import { useMemo } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { T3WorkSidebarPinnedItem } from "~/t3work/t3work-sidebarPinningTypes";
import type { ProjectTicket } from "~/t3work/t3work-types";

export type ResolvedPinnedSidebarItem =
  | {
      kind: "jira-work-item";
      pinnedItem: Extract<T3WorkSidebarPinnedItem, { kind: "jira-work-item" }>;
      ticket: ProjectTicket;
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
  githubActivityByWorkItem: ReadonlyMap<string, ReadonlyArray<GitHubWorkActivityItem>>;
  unlinkedGitHubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
}) {
  const { project, projectTickets, githubActivityByWorkItem, unlinkedGitHubActivityItems } = input;
  const pinnedSidebarItems = useT3WorkPinnedSidebarStore((state) => state.items);

  const ticketById = useMemo(
    () => new Map(projectTickets.map((ticket) => [ticket.id, ticket] as const)),
    [projectTickets],
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
        const ticket = ticketById.get(pinnedItem.ticketId);
        if (ticket) {
          resolvedItems.push({ kind: "jira-work-item", pinnedItem, ticket });
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
  }, [githubActivityById, pinnedSidebarItems, project.id, ticketById]);
}
