import { useT3workPersistedRouteState } from "~/t3work/hooks/t3work-usePersistedRouteState";

export type {
  PersistedProjectDashboardMyWorkState,
  ProjectDashboardMyWorkRouteSearch,
  ProjectDashboardMyWorkState,
  ProjectMyWorkGroupMode,
  ProjectMyWorkKanbanLaneSelectionMode,
  ProjectMyWorkTableSortBy,
  ProjectMyWorkTableSortDirection,
  ProjectMyWorkViewMode,
} from "./t3work-projectDashboardMyWorkStateShared";
export {
  createDefaultProjectDashboardMyWorkState,
  getProjectDashboardMyWorkStorageKey,
  parseProjectDashboardMyWorkRouteSearch,
  projectDashboardMyWorkRouteSearchKeys,
} from "./t3work-projectDashboardMyWorkStateShared";
export {
  areProjectDashboardMyWorkRouteSearchEqual,
  areProjectDashboardMyWorkStatesEqual,
  buildProjectDashboardMyWorkRouteSearch,
  readPersistedProjectDashboardMyWorkState,
  resolveProjectDashboardMyWorkState,
  stripProjectDashboardMyWorkSearchParams,
  writePersistedProjectDashboardMyWorkState,
} from "./t3work-projectDashboardMyWorkStatePersistence";

import {
  getProjectDashboardMyWorkStorageKey,
  parseProjectDashboardMyWorkRouteSearch,
} from "./t3work-projectDashboardMyWorkStateShared";
import {
  areProjectDashboardMyWorkRouteSearchEqual,
  areProjectDashboardMyWorkStatesEqual,
  buildProjectDashboardMyWorkRouteSearch,
  readPersistedProjectDashboardMyWorkState,
  resolveProjectDashboardMyWorkState,
  stripProjectDashboardMyWorkSearchParams,
  writePersistedProjectDashboardMyWorkState,
} from "./t3work-projectDashboardMyWorkStatePersistence";

export function useProjectDashboardMyWorkState(projectId: string) {
  return useT3workPersistedRouteState({
    storageKey: getProjectDashboardMyWorkStorageKey(projectId),
    parseSearch: parseProjectDashboardMyWorkRouteSearch,
    readPersistedState: readPersistedProjectDashboardMyWorkState,
    writePersistedState: writePersistedProjectDashboardMyWorkState,
    resolveState: resolveProjectDashboardMyWorkState,
    buildRouteSearch: buildProjectDashboardMyWorkRouteSearch,
    areStatesEqual: areProjectDashboardMyWorkStatesEqual,
    areRouteSearchEqual: areProjectDashboardMyWorkRouteSearchEqual,
    stripRouteSearchParams: stripProjectDashboardMyWorkSearchParams,
  });
}
