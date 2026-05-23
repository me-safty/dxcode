import { useT3workPersistedRouteState } from "~/t3work/hooks/t3work-usePersistedRouteState";
import {
  areProjectDashboardModeRouteSearchEqual,
  areProjectDashboardModeStatesEqual,
  buildProjectDashboardModeRouteSearch,
  getProjectDashboardModeStorageKey,
  parseProjectDashboardModeRouteSearch,
  readPersistedProjectDashboardModeState,
  resolveProjectDashboardModeState,
  stripProjectDashboardModeSearchParams,
  writePersistedProjectDashboardModeState,
} from "~/t3work/t3work-projectDashboardModeState";

export function useProjectDashboardModeState(projectId: string) {
  return useT3workPersistedRouteState({
    storageKey: getProjectDashboardModeStorageKey(projectId),
    parseSearch: parseProjectDashboardModeRouteSearch,
    readPersistedState: readPersistedProjectDashboardModeState,
    writePersistedState: writePersistedProjectDashboardModeState,
    resolveState: resolveProjectDashboardModeState,
    buildRouteSearch: buildProjectDashboardModeRouteSearch,
    areStatesEqual: areProjectDashboardModeStatesEqual,
    areRouteSearchEqual: areProjectDashboardModeRouteSearchEqual,
    stripRouteSearchParams: stripProjectDashboardModeSearchParams,
  });
}
