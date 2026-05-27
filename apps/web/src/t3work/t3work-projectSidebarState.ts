import type { TicketViewMode } from "~/t3work/components/t3work-projectSidebarShared";
import type { ProjectSortOrder, ThreadSortOrder } from "~/t3work/t3work-types";

export interface ProjectSidebarRouteSearch {
  navProjectSort?: ProjectSortOrder;
  navThreadSort?: ThreadSortOrder;
  navThreadCount?: number;
  navTicketView?: TicketViewMode;
  navThreads?: boolean;
  navActivity?: boolean;
  navJira?: boolean;
  navGitHub?: boolean;
}

export interface ProjectSidebarState {
  projectSortOrder: ProjectSortOrder;
  threadSortOrder: ThreadSortOrder;
  threadPreviewCount: number;
  ticketViewMode: TicketViewMode;
  showProjectThreads: boolean;
  showMyActivityFeed: boolean;
  showJiraItems: boolean;
  showGitHubActivity: boolean;
}

export type PersistedProjectSidebarState = Partial<ProjectSidebarState>;

export {
  areProjectSidebarRouteSearchEqual,
  areProjectSidebarStatesEqual,
  buildProjectSidebarRouteSearch,
  clampProjectSidebarThreadPreviewCount,
  createDefaultProjectSidebarState,
  getProjectSidebarStorageKey,
  parseProjectSidebarRouteSearch,
  projectSidebarRouteSearchKeys,
  readPersistedProjectSidebarState,
  resolveProjectSidebarState,
  stripProjectSidebarSearchParams,
  writePersistedProjectSidebarState,
} from "./t3work-projectSidebarStateShared";
