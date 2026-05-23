export type T3WorkSidebarPinnedItem =
  | {
      id: string;
      kind: "jira-work-item";
      projectId: string;
      ticketId: string;
      pinnedAt: string;
    }
  | {
      id: string;
      kind: "github-activity";
      projectId: string;
      activityId: string;
      pinnedAt: string;
    };

export type T3WorkSidebarPinActionState = {
  item: T3WorkSidebarPinnedItem;
  pinned: boolean;
  visibleInSidebar?: boolean;
  pinLabel?: string;
  unpinLabel?: string;
};

export function buildTicketSidebarPinnedItemId(input: {
  projectId: string;
  ticketId: string;
}): string {
  return `${input.projectId}:jira-work-item:${input.ticketId}`;
}

export function buildGitHubActivitySidebarPinnedItemId(input: {
  projectId: string;
  activityId: string;
}): string {
  return `${input.projectId}:github-activity:${input.activityId}`;
}

export function buildTicketSidebarPinnedItem(input: {
  projectId: string;
  ticketId: string;
  pinnedAt?: string;
}): T3WorkSidebarPinnedItem {
  return {
    id: buildTicketSidebarPinnedItemId(input),
    kind: "jira-work-item",
    projectId: input.projectId,
    ticketId: input.ticketId,
    pinnedAt: input.pinnedAt ?? new Date().toISOString(),
  };
}

export function buildGitHubActivitySidebarPinnedItem(input: {
  projectId: string;
  activityId: string;
  pinnedAt?: string;
}): T3WorkSidebarPinnedItem {
  return {
    id: buildGitHubActivitySidebarPinnedItemId(input),
    kind: "github-activity",
    projectId: input.projectId,
    activityId: input.activityId,
    pinnedAt: input.pinnedAt ?? new Date().toISOString(),
  };
}
