import type { ProjectDashboardMode } from "~/t3work/t3work-projectDashboardModeState";
import type { ProjectThread } from "~/t3work/t3work-types";

type DashboardThreadsByMode = Record<ProjectDashboardMode, ProjectThread[]>;

type BuildProjectSidebarThreadGroupsOptions = {
  visibleTicketIds?: ReadonlySet<string>;
};

export function buildProjectSidebarThreadGroups(
  threads: ReadonlyArray<ProjectThread>,
  options: BuildProjectSidebarThreadGroupsOptions = {},
): {
  projectLevelThreads: ProjectThread[];
  dashboardThreadsByMode: DashboardThreadsByMode;
  ticketThreadsById: Map<string, ProjectThread[]>;
} {
  const projectLevelThreads: ProjectThread[] = [];
  const dashboardThreadsByMode: DashboardThreadsByMode = {
    backlog: [],
    "my-work": [],
  };
  const ticketThreadsById = new Map<string, ProjectThread[]>();
  const visibleTicketIds = options.visibleTicketIds;

  for (const thread of threads) {
    if (thread.ticketId) {
      if (visibleTicketIds && !visibleTicketIds.has(thread.ticketId)) {
        projectLevelThreads.push(thread);
        continue;
      }

      const existing = ticketThreadsById.get(thread.ticketId) ?? [];
      existing.push(thread);
      ticketThreadsById.set(thread.ticketId, existing);
      continue;
    }

    if (thread.dashboardMode) {
      dashboardThreadsByMode[thread.dashboardMode].push(thread);
      continue;
    }

    projectLevelThreads.push(thread);
  }

  return {
    projectLevelThreads,
    dashboardThreadsByMode,
    ticketThreadsById,
  };
}
