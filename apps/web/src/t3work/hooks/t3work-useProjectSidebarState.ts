import { useT3workPersistedRouteState } from "~/t3work/hooks/t3work-usePersistedRouteState";
import {
  areProjectSidebarRouteSearchEqual,
  areProjectSidebarStatesEqual,
  buildProjectSidebarRouteSearch,
  getProjectSidebarStorageKey,
  parseProjectSidebarRouteSearch,
  readPersistedProjectSidebarState,
  resolveProjectSidebarState,
  stripProjectSidebarSearchParams,
  writePersistedProjectSidebarState,
} from "~/t3work/t3work-projectSidebarState";

export function useProjectSidebarState() {
  return useT3workPersistedRouteState({
    storageKey: getProjectSidebarStorageKey(),
    parseSearch: parseProjectSidebarRouteSearch,
    readPersistedState: readPersistedProjectSidebarState,
    writePersistedState: writePersistedProjectSidebarState,
    resolveState: resolveProjectSidebarState,
    buildRouteSearch: buildProjectSidebarRouteSearch,
    areStatesEqual: areProjectSidebarStatesEqual,
    areRouteSearchEqual: areProjectSidebarRouteSearchEqual,
    stripRouteSearchParams: stripProjectSidebarSearchParams,
  });
}
