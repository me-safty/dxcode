import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

import { randomUUID } from "./lib/utils";

export const PERSISTED_STATE_KEY = "t3code:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export interface PersistedUiState {
  collapsedProjectCwds?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  defaultAdvertisedEndpointKey?: string | null;
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
  threadGroups?: Array<{ id: string; projectKey: string; name: string; threadKeys: string[] }>;
  threadGroupOrderByProjectKey?: Record<string, string[]>;
  collapsedThreadGroupIds?: string[];
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
}

/**
 * A user-defined, client-only folder that groups a single project's threads in
 * the sidebar. Membership and within-folder order are both represented by the
 * ordered `threadKeys` array (the single source of truth). Folders are scoped to
 * one logical project via `projectKey`.
 */
export interface ThreadGroup {
  /** Stable generated id (see newThreadGroupId); never derived from contents. */
  id: string;
  /** Logical project key the folder lives under (same space as projectExpandedById). */
  projectKey: string;
  name: string;
  /** Ordered membership; the array order is the within-folder display order. */
  threadKeys: string[];
}

export interface UiGroupState {
  threadGroupsById: Record<string, ThreadGroup>;
  /** Ordered folder ids per logical project key. */
  threadGroupOrderByProjectKey: Record<string, string[]>;
  /** Folder collapse state. Absent id defaults to expanded, like projectExpandedById. */
  threadGroupExpandedById: Record<string, boolean>;
  /** Derived reverse index (threadKey -> groupId). Rebuilt on mutation; not persisted. */
  groupIdByThreadKey: Record<string, string>;
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
}

export interface UiEndpointState {
  defaultAdvertisedEndpointKey: string | null;
}

export interface UiState extends UiProjectState, UiThreadState, UiEndpointState, UiGroupState {}

export interface SyncProjectInput {
  /** Physical project key (env + cwd). Used for manual sort order. */
  key: string;
  /** Logical group key. Used for expand/collapse state. */
  logicalKey: string;
  cwd: string;
}

export interface SyncThreadInput {
  key: string;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  threadChangedFilesExpandedById: {},
  defaultAdvertisedEndpointKey: null,
  threadGroupsById: {},
  threadGroupOrderByProjectKey: {},
  threadGroupExpandedById: {},
  groupIdByThreadKey: {},
};

const persistedCollapsedProjectCwds = new Set<string>();
const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
const persistedProjectOrderCwdSet = new Set<string>();
// Pre-fix persisted shape only listed expanded cwds, so anything not listed
// was treated as collapsed. Track whether the loaded blob carried the new
// `collapsedProjectCwds` field so we can preserve that legacy semantic for
// one session after upgrade, until persistState rewrites in the new shape.
let persistedProjectStateUsesLegacyShape = false;
const currentProjectCwdById = new Map<string, string>();
const currentProjectCwdsByLogicalKey = new Map<string, string[]>();
const currentLogicalKeyByPhysicalKey = new Map<string, string>();
let legacyKeysCleanedUp = false;

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        hydratePersistedProjectState(JSON.parse(legacyRaw) as PersistedUiState);
        return initialState;
      }
      return initialState;
    }
    const parsed = JSON.parse(raw) as PersistedUiState;
    hydratePersistedProjectState(parsed);
    return {
      ...initialState,
      defaultAdvertisedEndpointKey:
        typeof parsed.defaultAdvertisedEndpointKey === "string" &&
        parsed.defaultAdvertisedEndpointKey.length > 0
          ? parsed.defaultAdvertisedEndpointKey
          : null,
      threadChangedFilesExpandedById: sanitizePersistedThreadChangedFilesExpanded(
        parsed.threadChangedFilesExpandedById,
      ),
      ...sanitizePersistedThreadGroups(parsed),
    };
  } catch {
    return initialState;
  }
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean" && expanded === false) {
        nextTurns[turnId] = false;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

/** Recompute the derived threadKey -> groupId reverse index from scratch. */
function rebuildGroupIndex(groups: Record<string, ThreadGroup>): Record<string, string> {
  const index: Record<string, string> = {};
  for (const group of Object.values(groups)) {
    for (const threadKey of group.threadKeys) {
      index[threadKey] = group.id;
    }
  }
  return index;
}

/** Drop the given threadKeys from every folder. Returns the same map if unchanged. */
function removeThreadKeysFromGroups(
  groups: Record<string, ThreadGroup>,
  threadKeys: ReadonlySet<string>,
): Record<string, ThreadGroup> {
  let changed = false;
  const next: Record<string, ThreadGroup> = {};
  for (const [id, group] of Object.entries(groups)) {
    const filtered = group.threadKeys.filter((key) => !threadKeys.has(key));
    if (filtered.length !== group.threadKeys.length) {
      changed = true;
      next[id] = { ...group, threadKeys: filtered };
    } else {
      next[id] = group;
    }
  }
  return changed ? next : groups;
}

function dedupePreserveOrder(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

export function sanitizePersistedThreadGroups(
  parsed: PersistedUiState,
): Pick<
  UiState,
  | "threadGroupsById"
  | "threadGroupOrderByProjectKey"
  | "threadGroupExpandedById"
  | "groupIdByThreadKey"
> {
  const threadGroupsById: Record<string, ThreadGroup> = {};
  for (const raw of parsed.threadGroups ?? []) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.id !== "string" ||
      raw.id.length === 0 ||
      typeof raw.projectKey !== "string" ||
      raw.projectKey.length === 0 ||
      typeof raw.name !== "string"
    ) {
      continue;
    }
    const threadKeys = Array.isArray(raw.threadKeys)
      ? dedupePreserveOrder(
          raw.threadKeys.filter((key): key is string => typeof key === "string" && key.length > 0),
        )
      : [];
    threadGroupsById[raw.id] = {
      id: raw.id,
      projectKey: raw.projectKey,
      name: raw.name,
      threadKeys,
    };
  }

  const threadGroupOrderByProjectKey: Record<string, string[]> = {};
  for (const [projectKey, order] of Object.entries(parsed.threadGroupOrderByProjectKey ?? {})) {
    if (typeof projectKey !== "string" || !Array.isArray(order)) {
      continue;
    }
    const filtered = dedupePreserveOrder(
      order.filter((id): id is string => typeof id === "string" && id in threadGroupsById),
    );
    if (filtered.length > 0) {
      threadGroupOrderByProjectKey[projectKey] = filtered;
    }
  }
  // Defensively append any folder missing from its project's order list.
  for (const group of Object.values(threadGroupsById)) {
    const order = threadGroupOrderByProjectKey[group.projectKey] ?? [];
    if (!order.includes(group.id)) {
      threadGroupOrderByProjectKey[group.projectKey] = [...order, group.id];
    }
  }

  const collapsed = new Set(
    (parsed.collapsedThreadGroupIds ?? []).filter((id): id is string => typeof id === "string"),
  );
  const threadGroupExpandedById: Record<string, boolean> = {};
  for (const id of Object.keys(threadGroupsById)) {
    if (collapsed.has(id)) {
      threadGroupExpandedById[id] = false;
    }
  }

  return {
    threadGroupsById,
    threadGroupOrderByProjectKey,
    threadGroupExpandedById,
    groupIdByThreadKey: rebuildGroupIndex(threadGroupsById),
  };
}

export function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedCollapsedProjectCwds.clear();
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  persistedProjectOrderCwdSet.clear();
  persistedProjectStateUsesLegacyShape = !Array.isArray(parsed.collapsedProjectCwds);
  for (const cwd of parsed.collapsedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedCollapsedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwdSet.has(cwd)) {
      persistedProjectOrderCwdSet.add(cwd);
      persistedProjectOrderCwds.push(cwd);
    }
  }
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    // Persist collapsed cwds explicitly so an empty/missing field unambiguously
    // means "first install" rather than "user collapsed everything"; without
    // this, the syncProjects fallback would re-expand all rows on next launch.
    const collapsedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => !expanded)
      .flatMap(([logicalKey]) => currentProjectCwdsByLogicalKey.get(logicalKey) ?? []);
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([logicalKey]) => currentProjectCwdsByLogicalKey.get(logicalKey) ?? []);
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    const threadChangedFilesExpandedById = Object.fromEntries(
      Object.entries(state.threadChangedFilesExpandedById).flatMap(([threadId, turns]) => {
        const nextTurns = Object.fromEntries(
          Object.entries(turns).filter(([, expanded]) => expanded === false),
        );
        return Object.keys(nextTurns).length > 0 ? [[threadId, nextTurns]] : [];
      }),
    );
    const threadGroups = Object.values(state.threadGroupsById).map((group) => ({
      id: group.id,
      projectKey: group.projectKey,
      name: group.name,
      threadKeys: group.threadKeys,
    }));
    const collapsedThreadGroupIds = Object.entries(state.threadGroupExpandedById)
      .filter(([, expanded]) => !expanded)
      .map(([id]) => id);
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        collapsedProjectCwds,
        expandedProjectCwds,
        projectOrderCwds,
        defaultAdvertisedEndpointKey: state.defaultAdvertisedEndpointKey,
        threadChangedFilesExpandedById,
        threadGroups,
        threadGroupOrderByProjectKey: state.threadGroupOrderByProjectKey,
        collapsedThreadGroupIds,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function nestedBooleanRecordsEqual(
  left: Record<string, Record<string, boolean>>,
  right: Record<string, Record<string, boolean>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (!(key in right) || !recordsEqual(value, right[key]!)) {
      return false;
    }
  }
  return true;
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousLogicalKeyByPhysicalKey = new Map(currentLogicalKeyByPhysicalKey);
  currentProjectCwdById.clear();
  currentLogicalKeyByPhysicalKey.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.key, project.cwd);
    currentLogicalKeyByPhysicalKey.set(project.key, project.logicalKey);
  }
  currentProjectCwdsByLogicalKey.clear();
  const currentProjectCwdSetsByLogicalKey = new Map<string, Set<string>>();
  for (const project of projects) {
    const cwds = currentProjectCwdsByLogicalKey.get(project.logicalKey);
    if (cwds) {
      let cwdSet = currentProjectCwdSetsByLogicalKey.get(project.logicalKey);
      if (!cwdSet) {
        cwdSet = new Set(cwds);
        currentProjectCwdSetsByLogicalKey.set(project.logicalKey, cwdSet);
      }
      if (!cwdSet.has(project.cwd)) {
        cwdSet.add(project.cwd);
        cwds.push(project.cwd);
      }
    } else {
      currentProjectCwdsByLogicalKey.set(project.logicalKey, [project.cwd]);
      currentProjectCwdSetsByLogicalKey.set(project.logicalKey, new Set([project.cwd]));
    }
  }
  // Build reverse map: for each new logical key, which previous logical keys
  // did its member projects live under? Lets us preserve expand state when a
  // project's logical key changes (e.g. late-arriving repo metadata flips the
  // group identity).
  const previousLogicalKeysByNewLogicalKey = new Map<string, Set<string>>();
  for (const project of projects) {
    const previousLogicalKey = previousLogicalKeyByPhysicalKey.get(project.key);
    if (!previousLogicalKey || previousLogicalKey === project.logicalKey) {
      continue;
    }
    const set = previousLogicalKeysByNewLogicalKey.get(project.logicalKey);
    if (set) {
      set.add(previousLogicalKey);
    } else {
      previousLogicalKeysByNewLogicalKey.set(project.logicalKey, new Set([previousLogicalKey]));
    }
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.key) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    if (!(project.logicalKey in nextExpandedById)) {
      const groupCwds = currentProjectCwdsByLogicalKey.get(project.logicalKey) ?? [project.cwd];
      const fallbackFromPreviousLogicalKey = (() => {
        const previousKeys = previousLogicalKeysByNewLogicalKey.get(project.logicalKey);
        if (!previousKeys) {
          return undefined;
        }
        for (const previousKey of previousKeys) {
          if (previousKey in previousExpandedById) {
            return previousExpandedById[previousKey];
          }
        }
        return undefined;
      })();
      const fallbackFromPersistedShape = (() => {
        if (groupCwds.some((cwd) => persistedExpandedProjectCwds.has(cwd))) {
          return true;
        }
        if (groupCwds.some((cwd) => persistedCollapsedProjectCwds.has(cwd))) {
          return false;
        }
        if (persistedProjectStateUsesLegacyShape && persistedExpandedProjectCwds.size > 0) {
          return false;
        }
        return true;
      })();
      const expanded =
        previousExpandedById[project.logicalKey] ??
        fallbackFromPreviousLogicalKey ??
        fallbackFromPersistedShape;
      nextExpandedById[project.logicalKey] = expanded;
    }
    return {
      id: project.key,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const currentProjectIds = new Set(mappedProjects.map((project) => project.id));
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<string>();
          const orderedProjectIds: string[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (currentProjectIds.has(projectId) ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.key));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.key] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.key] = thread.seedVisitedAt;
    }
  }
  const nextThreadChangedFilesExpandedById = Object.fromEntries(
    Object.entries(state.threadChangedFilesExpandedById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    nestedBooleanRecordsEqual(
      state.threadChangedFilesExpandedById,
      nextThreadChangedFilesExpandedById,
    )
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    threadChangedFilesExpandedById: nextThreadChangedFilesExpandedById,
  };
}

export function markThreadVisited(state: UiState, threadId: string, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: string): UiState {
  const hasVisitedState = threadId in state.threadLastVisitedAtById;
  const hasChangedFilesState = threadId in state.threadChangedFilesExpandedById;
  if (!hasVisitedState && !hasChangedFilesState) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  const nextThreadChangedFilesExpandedById = { ...state.threadChangedFilesExpandedById };
  delete nextThreadLastVisitedAtById[threadId];
  delete nextThreadChangedFilesExpandedById[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    threadChangedFilesExpandedById: nextThreadChangedFilesExpandedById,
  };
}

export function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  const currentExpanded = currentThreadState[turnId] ?? true;
  if (currentExpanded === expanded) {
    return state;
  }

  if (expanded) {
    if (!(turnId in currentThreadState)) {
      return state;
    }

    const nextThreadState = { ...currentThreadState };
    delete nextThreadState[turnId];
    if (Object.keys(nextThreadState).length === 0) {
      const nextState = { ...state.threadChangedFilesExpandedById };
      delete nextState[threadId];
      return {
        ...state,
        threadChangedFilesExpandedById: nextState,
      };
    }

    return {
      ...state,
      threadChangedFilesExpandedById: {
        ...state.threadChangedFilesExpandedById,
        [threadId]: nextThreadState,
      },
    };
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: false,
      },
    },
  };
}

export function setDefaultAdvertisedEndpointKey(state: UiState, key: string | null): UiState {
  const nextKey = key && key.length > 0 ? key : null;
  if (state.defaultAdvertisedEndpointKey === nextKey) {
    return state;
  }
  return {
    ...state,
    defaultAdvertisedEndpointKey: nextKey,
  };
}

export function toggleProject(state: UiState, projectId: string): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(state: UiState, projectId: string, expanded: boolean): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = state.projectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...state.projectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

/** Generate a stable, unique thread-folder id. */
export function newThreadGroupId(): string {
  return `grp_${randomUUID()}`;
}

export function createThreadGroup(
  state: UiState,
  args: { projectKey: string; id: string; name: string; threadKeys?: readonly string[] },
): UiState {
  const { projectKey, id, name } = args;
  if (id in state.threadGroupsById) {
    return state;
  }
  const memberKeys = dedupePreserveOrder(args.threadKeys ?? []);
  const groupsWithoutMembers =
    memberKeys.length > 0
      ? removeThreadKeysFromGroups(state.threadGroupsById, new Set(memberKeys))
      : state.threadGroupsById;
  const nextGroups: Record<string, ThreadGroup> = {
    ...groupsWithoutMembers,
    [id]: { id, projectKey, name, threadKeys: memberKeys },
  };
  const order = state.threadGroupOrderByProjectKey[projectKey] ?? [];
  return {
    ...state,
    threadGroupsById: nextGroups,
    threadGroupOrderByProjectKey: {
      ...state.threadGroupOrderByProjectKey,
      [projectKey]: [...order, id],
    },
    groupIdByThreadKey: rebuildGroupIndex(nextGroups),
  };
}

export function renameThreadGroup(state: UiState, groupId: string, name: string): UiState {
  const group = state.threadGroupsById[groupId];
  const trimmed = name.trim();
  if (!group || trimmed.length === 0 || group.name === trimmed) {
    return state;
  }
  return {
    ...state,
    threadGroupsById: {
      ...state.threadGroupsById,
      [groupId]: { ...group, name: trimmed },
    },
  };
}

export function deleteThreadGroup(state: UiState, groupId: string): UiState {
  const group = state.threadGroupsById[groupId];
  if (!group) {
    return state;
  }
  const nextGroups = { ...state.threadGroupsById };
  delete nextGroups[groupId];

  const nextOrderByProject = { ...state.threadGroupOrderByProjectKey };
  const order = nextOrderByProject[group.projectKey];
  if (order) {
    const filtered = order.filter((id) => id !== groupId);
    if (filtered.length > 0) {
      nextOrderByProject[group.projectKey] = filtered;
    } else {
      delete nextOrderByProject[group.projectKey];
    }
  }

  const nextExpanded = { ...state.threadGroupExpandedById };
  delete nextExpanded[groupId];

  return {
    ...state,
    threadGroupsById: nextGroups,
    threadGroupOrderByProjectKey: nextOrderByProject,
    threadGroupExpandedById: nextExpanded,
    groupIdByThreadKey: rebuildGroupIndex(nextGroups),
  };
}

export function toggleThreadGroup(state: UiState, groupId: string): UiState {
  if (!(groupId in state.threadGroupsById)) {
    return state;
  }
  const expanded = state.threadGroupExpandedById[groupId] ?? true;
  return {
    ...state,
    threadGroupExpandedById: {
      ...state.threadGroupExpandedById,
      [groupId]: !expanded,
    },
  };
}

export function setThreadGroupExpanded(
  state: UiState,
  groupId: string,
  expanded: boolean,
): UiState {
  if (
    !(groupId in state.threadGroupsById) ||
    (state.threadGroupExpandedById[groupId] ?? true) === expanded
  ) {
    return state;
  }
  return {
    ...state,
    threadGroupExpandedById: {
      ...state.threadGroupExpandedById,
      [groupId]: expanded,
    },
  };
}

/**
 * Move one or more threads into a folder (or out to ungrouped when
 * targetGroupId is null). Also performs intra-folder reordering: each thread is
 * first removed from whatever folder holds it, then inserted into the target at
 * `beforeThreadKey` (or appended when null/absent). Mirrors reorderProjects in
 * taking an array so multi-select moves work in one call.
 */
export function moveThreadsToGroup(
  state: UiState,
  threadKeys: readonly string[],
  targetGroupId: string | null,
  beforeThreadKey?: string | null,
): UiState {
  if (threadKeys.length === 0) {
    return state;
  }
  if (targetGroupId !== null && !(targetGroupId in state.threadGroupsById)) {
    return state;
  }
  const movingKeys = dedupePreserveOrder(threadKeys);
  const movingSet = new Set(movingKeys);
  const groupsAfterRemoval = removeThreadKeysFromGroups(state.threadGroupsById, movingSet);

  let nextGroups = groupsAfterRemoval;
  if (targetGroupId !== null) {
    const target = groupsAfterRemoval[targetGroupId]!;
    const insertAt =
      beforeThreadKey != null
        ? (() => {
            const idx = target.threadKeys.indexOf(beforeThreadKey);
            return idx < 0 ? target.threadKeys.length : idx;
          })()
        : target.threadKeys.length;
    const nextThreadKeys = [
      ...target.threadKeys.slice(0, insertAt),
      ...movingKeys,
      ...target.threadKeys.slice(insertAt),
    ];
    nextGroups = {
      ...groupsAfterRemoval,
      [targetGroupId]: { ...target, threadKeys: nextThreadKeys },
    };
  }

  if (nextGroups === state.threadGroupsById) {
    return state;
  }
  return {
    ...state,
    threadGroupsById: nextGroups,
    groupIdByThreadKey: rebuildGroupIndex(nextGroups),
  };
}

/** Reorder a folder within its project's folder list, inserting before overGroupId. */
export function reorderThreadGroups(
  state: UiState,
  projectKey: string,
  draggedGroupId: string,
  overGroupId: string,
): UiState {
  if (draggedGroupId === overGroupId) {
    return state;
  }
  const order = state.threadGroupOrderByProjectKey[projectKey];
  if (!order) {
    return state;
  }
  const fromIndex = order.indexOf(draggedGroupId);
  const toIndex = order.indexOf(overGroupId);
  if (fromIndex < 0 || toIndex < 0) {
    return state;
  }
  const next = [...order];
  next.splice(fromIndex, 1);
  const insertAt = next.indexOf(overGroupId);
  next.splice(insertAt, 0, draggedGroupId);
  return {
    ...state,
    threadGroupOrderByProjectKey: {
      ...state.threadGroupOrderByProjectKey,
      [projectKey]: next,
    },
  };
}

/**
 * Garbage-collect folder state against the live snapshot: drop memberships for
 * threads that no longer exist, and drop folders that have become empty AND
 * whose project is no longer rendered. Empty folders in a live project are kept
 * (a freshly-created folder must survive). Folders whose projectKey is stale but
 * still hold live members are left intact (their members fall back to ungrouped
 * until the project reappears) — see the projectKey-stability note in the plan.
 */
export function syncThreadGroups(
  state: UiState,
  args: { liveThreadKeys: ReadonlySet<string>; liveProjectKeys: ReadonlySet<string> },
): UiState {
  const { liveThreadKeys, liveProjectKeys } = args;
  let changed = false;
  const nextGroups: Record<string, ThreadGroup> = {};
  for (const [id, group] of Object.entries(state.threadGroupsById)) {
    const prunedKeys = group.threadKeys.filter((key) => liveThreadKeys.has(key));
    const projectLive = liveProjectKeys.has(group.projectKey);
    if (prunedKeys.length === 0 && !projectLive) {
      changed = true;
      continue;
    }
    if (prunedKeys.length !== group.threadKeys.length) {
      changed = true;
      nextGroups[id] = { ...group, threadKeys: prunedKeys };
    } else {
      nextGroups[id] = group;
    }
  }
  if (!changed) {
    return state;
  }

  const nextOrderByProject: Record<string, string[]> = {};
  for (const [projectKey, order] of Object.entries(state.threadGroupOrderByProjectKey)) {
    const filtered = order.filter((id) => id in nextGroups);
    if (filtered.length > 0) {
      nextOrderByProject[projectKey] = filtered;
    }
  }
  const nextExpanded: Record<string, boolean> = {};
  for (const [id, expanded] of Object.entries(state.threadGroupExpandedById)) {
    if (id in nextGroups) {
      nextExpanded[id] = expanded;
    }
  }
  return {
    ...state,
    threadGroupsById: nextGroups,
    threadGroupOrderByProjectKey: nextOrderByProject,
    threadGroupExpandedById: nextExpanded,
    groupIdByThreadKey: rebuildGroupIndex(nextGroups),
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: string, visitedAt?: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: string) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
  toggleProject: (projectId: string) => void;
  setProjectExpanded: (projectId: string, expanded: boolean) => void;
  reorderProjects: (
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
  createThreadGroup: (args: {
    projectKey: string;
    id: string;
    name: string;
    threadKeys?: readonly string[];
  }) => void;
  renameThreadGroup: (groupId: string, name: string) => void;
  deleteThreadGroup: (groupId: string) => void;
  toggleThreadGroup: (groupId: string) => void;
  setThreadGroupExpanded: (groupId: string, expanded: boolean) => void;
  moveThreadsToGroup: (
    threadKeys: readonly string[],
    targetGroupId: string | null,
    beforeThreadKey?: string | null,
  ) => void;
  reorderThreadGroups: (projectKey: string, draggedGroupId: string, overGroupId: string) => void;
  syncThreadGroups: (args: {
    liveThreadKeys: ReadonlySet<string>;
    liveProjectKeys: ReadonlySet<string>;
  }) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  setDefaultAdvertisedEndpointKey: (key) =>
    set((state) => setDefaultAdvertisedEndpointKey(state, key)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectIds, targetProjectIds) =>
    set((state) => reorderProjects(state, draggedProjectIds, targetProjectIds)),
  createThreadGroup: (args) => set((state) => createThreadGroup(state, args)),
  renameThreadGroup: (groupId, name) => set((state) => renameThreadGroup(state, groupId, name)),
  deleteThreadGroup: (groupId) => set((state) => deleteThreadGroup(state, groupId)),
  toggleThreadGroup: (groupId) => set((state) => toggleThreadGroup(state, groupId)),
  setThreadGroupExpanded: (groupId, expanded) =>
    set((state) => setThreadGroupExpanded(state, groupId, expanded)),
  moveThreadsToGroup: (threadKeys, targetGroupId, beforeThreadKey) =>
    set((state) => moveThreadsToGroup(state, threadKeys, targetGroupId, beforeThreadKey)),
  reorderThreadGroups: (projectKey, draggedGroupId, overGroupId) =>
    set((state) => reorderThreadGroups(state, projectKey, draggedGroupId, overGroupId)),
  syncThreadGroups: (args) => set((state) => syncThreadGroups(state, args)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
