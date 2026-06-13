import { ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clearThreadUi,
  createThreadGroup,
  deleteThreadGroup,
  hydratePersistedProjectState,
  markThreadVisited,
  markThreadUnread,
  moveThreadsToGroup,
  PERSISTED_STATE_KEY,
  type PersistedUiState,
  persistState,
  renameThreadGroup,
  reorderProjects,
  reorderThreadGroups,
  sanitizePersistedThreadGroups,
  setDefaultAdvertisedEndpointKey,
  setProjectExpanded,
  setThreadChangedFilesExpanded,
  setThreadGroupExpanded,
  syncProjects,
  syncThreadGroups,
  syncThreads,
  toggleThreadGroup,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    defaultAdvertisedEndpointKey: null,
    threadGroupsById: {},
    threadGroupOrderByProjectKey: {},
    threadGroupExpandedById: {},
    groupIdByThreadKey: {},
    ...overrides,
  };
}

describe("uiStateStore pure functions", () => {
  it("markThreadVisited stores the provided server timestamp", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState();

    const next = markThreadVisited(initialState, threadId, "2026-02-25T12:30:00.700Z");

    expect(next.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:30:00.700Z");
  });

  it("markThreadVisited does not move visit state backwards under clock skew", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:30:00.700Z",
      },
    });

    const next = markThreadVisited(initialState, threadId, "2026-02-25T12:30:00.000Z");

    expect(next).toBe(initialState);
  });

  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const threadId = ThreadId.make("thread-1");
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, latestTurnCompletedAt);

    expect(next.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:29:59.999Z");
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, null);

    expect(next).toBe(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.make("project-1");
    const project2 = ProjectId.make("project-2");
    const project3 = ProjectId.make("project-3");
    const initialState = makeUiState({
      projectOrder: [project1, project2, project3],
    });

    const next = reorderProjects(initialState, [project1], [project3]);

    expect(next.projectOrder).toEqual([project2, project3, project1]);
  });

  it("reorderProjects is a no-op when dragged key is not in projectOrder", () => {
    const project1 = ProjectId.make("project-1");
    const project2 = ProjectId.make("project-2");
    const initialState = makeUiState({
      projectOrder: [project1, project2],
    });

    const next = reorderProjects(initialState, [ProjectId.make("missing")], [project2]);

    expect(next).toBe(initialState);
  });

  it("setDefaultAdvertisedEndpointKey stores endpoint preference by stable key", () => {
    const initialState = makeUiState();

    const next = setDefaultAdvertisedEndpointKey(initialState, "desktop-core:lan:http");

    expect(next.defaultAdvertisedEndpointKey).toBe("desktop-core:lan:http");
    expect(setDefaultAdvertisedEndpointKey(next, "desktop-core:lan:http")).toBe(next);
    expect(setDefaultAdvertisedEndpointKey(next, "")).toMatchObject({
      defaultAdvertisedEndpointKey: null,
    });
  });

  it("reorderProjects moves all member keys of a multi-member group together", () => {
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const keyB = "env-local:proj-b";
    const keyC = "env-local:proj-c";
    const initialState = makeUiState({
      projectOrder: [keyALocal, keyARemote, keyB, keyC],
    });

    const next = reorderProjects(initialState, [keyALocal, keyARemote], [keyC]);

    expect(next.projectOrder).toEqual([keyB, keyC, keyALocal, keyARemote]);
  });

  it("reorderProjects handles member keys scattered across projectOrder", () => {
    const keyALocal = "env-local:proj-a";
    const keyB = "env-local:proj-b";
    const keyARemote = "env-remote:proj-a";
    const keyC = "env-local:proj-c";
    const initialState = makeUiState({
      projectOrder: [keyALocal, keyB, keyARemote, keyC],
    });

    const next = reorderProjects(initialState, [keyALocal, keyARemote], [keyC]);

    expect(next.projectOrder).toEqual([keyB, keyC, keyALocal, keyARemote]);
  });

  it("reorderProjects places group after target when dragged from before a non-last target", () => {
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const keyB = "env-local:proj-b";
    const keyC = "env-local:proj-c";
    const keyD = "env-local:proj-d";
    const initialState = makeUiState({
      projectOrder: [keyALocal, keyARemote, keyB, keyC, keyD],
    });

    const next = reorderProjects(initialState, [keyALocal, keyARemote], [keyC]);

    expect(next.projectOrder).toEqual([keyB, keyC, keyALocal, keyARemote, keyD]);
  });

  it("reorderProjects places group before target when dragged from after", () => {
    const keyB = "env-local:proj-b";
    const keyC = "env-local:proj-c";
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const initialState = makeUiState({
      projectOrder: [keyB, keyC, keyALocal, keyARemote],
    });

    const next = reorderProjects(initialState, [keyALocal, keyARemote], [keyB]);

    expect(next.projectOrder).toEqual([keyALocal, keyARemote, keyB, keyC]);
  });

  it("reorderProjects with multi-member target inserts after first target occurrence", () => {
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const keyBLocal = "env-local:proj-b";
    const keyBRemote = "env-remote:proj-b";
    const initialState = makeUiState({
      projectOrder: [keyALocal, keyARemote, keyBLocal, keyBRemote],
    });

    const next = reorderProjects(initialState, [keyALocal, keyARemote], [keyBLocal, keyBRemote]);

    // Target members may become non-contiguous; this is fine because the
    // sidebar groups by logical key using first-occurrence positioning.
    expect(next.projectOrder).toEqual([keyBLocal, keyALocal, keyARemote, keyBRemote]);
  });

  it("reorderProjects is a no-op when dragged group equals target group", () => {
    const key1 = "env-local:proj-a";
    const key2 = "env-remote:proj-a";
    const initialState = makeUiState({
      projectOrder: [key1, key2, "env-local:proj-b"],
    });

    const next = reorderProjects(initialState, [key1, key2], [key1, key2]);

    expect(next).toBe(initialState);
  });

  it("reorderProjects is a no-op when dragged keys are not in projectOrder", () => {
    const initialState = makeUiState({
      projectOrder: ["env-local:proj-a", "env-local:proj-b"],
    });

    const next = reorderProjects(initialState, ["env-local:missing"], ["env-local:proj-b"]);

    expect(next).toBe(initialState);
  });

  it("syncProjects preserves current project order during snapshot recovery", () => {
    const project1 = ProjectId.make("project-1");
    const project2 = ProjectId.make("project-2");
    const project3 = ProjectId.make("project-3");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
        [project2]: false,
      },
      projectOrder: [project2, project1],
    });

    const next = syncProjects(initialState, [
      { key: project1, logicalKey: project1, cwd: "/tmp/project-1" },
      { key: project2, logicalKey: project2, cwd: "/tmp/project-2" },
      { key: project3, logicalKey: project3, cwd: "/tmp/project-3" },
    ]);

    expect(next.projectOrder).toEqual([project2, project1, project3]);
    expect(next.projectExpandedById[project2]).toBe(false);
  });

  it("syncProjects preserves manual order across project id churn at the same cwd", () => {
    // Under the current design, physical key and logical key are both
    // cwd-derived, so an internal project-id change doesn't alter the store
    // keys. This test locks in that stability: re-syncing the same cwds keeps
    // manual order and collapse state.
    const keyProject1 = "env-local:/tmp/project-1";
    const keyProject2 = "env-local:/tmp/project-2";
    const initialState = syncProjects(
      makeUiState({
        projectExpandedById: {
          [keyProject1]: true,
          [keyProject2]: false,
        },
        projectOrder: [keyProject2, keyProject1],
      }),
      [
        { key: keyProject1, logicalKey: keyProject1, cwd: "/tmp/project-1" },
        { key: keyProject2, logicalKey: keyProject2, cwd: "/tmp/project-2" },
      ],
    );

    const next = syncProjects(initialState, [
      { key: keyProject1, logicalKey: keyProject1, cwd: "/tmp/project-1" },
      { key: keyProject2, logicalKey: keyProject2, cwd: "/tmp/project-2" },
    ]);

    expect(next.projectOrder).toEqual([keyProject2, keyProject1]);
    expect(next.projectExpandedById[keyProject2]).toBe(false);
  });

  it("syncProjects returns a new state when only project cwd changes", () => {
    const project1 = ProjectId.make("project-1");
    const initialState = syncProjects(
      makeUiState({
        projectExpandedById: {
          [project1]: false,
        },
        projectOrder: [project1],
      }),
      [{ key: project1, logicalKey: project1, cwd: "/tmp/project-1" }],
    );

    const next = syncProjects(initialState, [
      { key: project1, logicalKey: project1, cwd: "/tmp/project-1-renamed" },
    ]);

    expect(next).not.toBe(initialState);
    expect(next.projectOrder).toEqual([project1]);
    expect(next.projectExpandedById[project1]).toBe(false);
  });

  it("syncProjects keys projectExpandedById by the logical key, not the physical key", () => {
    // In repository grouping mode, multiple physical projects (different
    // environments or different repo-relative paths) collapse into one
    // logical group. The group's expand state must be keyed by the logical
    // key so clicks on the grouped row toggle the shared state, and so the
    // state survives subsequent syncProjects calls (which rebuild the map
    // from incoming inputs).
    const physicalLocal = "env-local:/repo/project";
    const physicalRemote = "env-remote:/repo/project";
    const logicalKey = "repo-canonical-key";

    const initial = syncProjects(makeUiState(), [
      { key: physicalLocal, logicalKey, cwd: "/repo/project" },
      { key: physicalRemote, logicalKey, cwd: "/repo/project" },
    ]);

    expect(initial.projectExpandedById).toEqual({ [logicalKey]: true });

    const afterCollapse = { ...initial, projectExpandedById: { [logicalKey]: false } };
    const next = syncProjects(afterCollapse, [
      { key: physicalLocal, logicalKey, cwd: "/repo/project" },
      { key: physicalRemote, logicalKey, cwd: "/repo/project" },
    ]);

    expect(next.projectExpandedById[logicalKey]).toBe(false);
  });

  it("syncProjects preserves expand state when a project's logical key changes", () => {
    // Example: late-arriving repo metadata flips grouping identity from the
    // physical key to a canonical repository key. The row did not actually
    // change, so the user's collapse choice must carry over.
    const physicalKey = "env-local:/repo/project";
    const previousLogicalKey = physicalKey;
    const nextLogicalKey = "repo-canonical-key";

    const initial = syncProjects(makeUiState(), [
      { key: physicalKey, logicalKey: previousLogicalKey, cwd: "/repo/project" },
    ]);

    expect(initial.projectExpandedById[previousLogicalKey]).toBe(true);

    const afterCollapse = {
      ...initial,
      projectExpandedById: { [previousLogicalKey]: false },
    };
    const next = syncProjects(afterCollapse, [
      { key: physicalKey, logicalKey: nextLogicalKey, cwd: "/repo/project" },
    ]);

    expect(next.projectExpandedById[nextLogicalKey]).toBe(false);
  });

  it("syncThreads prunes missing thread UI state", () => {
    const thread1 = ThreadId.make("thread-1");
    const thread2 = ThreadId.make("thread-2");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
        [thread2]: "2026-02-25T12:36:00.000Z",
      },
      threadChangedFilesExpandedById: {
        [thread1]: {
          "turn-1": false,
        },
        [thread2]: {
          "turn-2": false,
        },
      },
    });

    const next = syncThreads(initialState, [{ key: thread1 }]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
    expect(next.threadChangedFilesExpandedById).toEqual({
      [thread1]: {
        "turn-1": false,
      },
    });
  });

  it("syncThreads seeds visit state for unseen snapshot threads", () => {
    const thread1 = ThreadId.make("thread-1");
    const initialState = makeUiState();

    const next = syncThreads(initialState, [
      {
        key: thread1,
        seedVisitedAt: "2026-02-25T12:35:00.000Z",
      },
    ]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
  });

  it("setProjectExpanded updates expansion without touching order", () => {
    const project1 = ProjectId.make("project-1");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
      },
      projectOrder: [project1],
    });

    const next = setProjectExpanded(initialState, project1, false);

    expect(next.projectExpandedById[project1]).toBe(false);
    expect(next.projectOrder).toEqual([project1]);
  });

  it("clearThreadUi removes visit state for deleted threads", () => {
    const thread1 = ThreadId.make("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
      },
      threadChangedFilesExpandedById: {
        [thread1]: {
          "turn-1": false,
        },
      },
    });

    const next = clearThreadUi(initialState, thread1);

    expect(next.threadLastVisitedAtById).toEqual({});
    expect(next.threadChangedFilesExpandedById).toEqual({});
  });

  it("setThreadChangedFilesExpanded stores collapsed turns per thread", () => {
    const thread1 = ThreadId.make("thread-1");
    const initialState = makeUiState();

    const next = setThreadChangedFilesExpanded(initialState, thread1, "turn-1", false);

    expect(next.threadChangedFilesExpandedById).toEqual({
      [thread1]: {
        "turn-1": false,
      },
    });
  });

  it("setThreadChangedFilesExpanded removes thread overrides when expanded again", () => {
    const thread1 = ThreadId.make("thread-1");
    const initialState = makeUiState({
      threadChangedFilesExpandedById: {
        [thread1]: {
          "turn-1": false,
        },
      },
    });

    const next = setThreadChangedFilesExpanded(initialState, thread1, "turn-1", true);

    expect(next.threadChangedFilesExpandedById).toEqual({});
  });
});

describe("uiStateStore thread folders", () => {
  const P = "proj-A";

  it("createThreadGroup registers the folder and appends to project order", () => {
    const next = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "Experiments" });

    expect(next.threadGroupsById.g1).toEqual({
      id: "g1",
      projectKey: P,
      name: "Experiments",
      threadKeys: [],
    });
    expect(next.threadGroupOrderByProjectKey[P]).toEqual(["g1"]);
  });

  it("createThreadGroup with members removes them from prior folders and indexes them", () => {
    let state = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "A" });
    state = moveThreadsToGroup(state, ["t1", "t2"], "g1");
    state = createThreadGroup(state, {
      projectKey: P,
      id: "g2",
      name: "B",
      threadKeys: ["t2", "t3"],
    });

    expect(state.threadGroupsById.g1!.threadKeys).toEqual(["t1"]);
    expect(state.threadGroupsById.g2!.threadKeys).toEqual(["t2", "t3"]);
    expect(state.groupIdByThreadKey).toEqual({ t1: "g1", t2: "g2", t3: "g2" });
  });

  it("moveThreadsToGroup is a single-folder move (at most one folder per thread)", () => {
    let state = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "A" });
    state = createThreadGroup(state, { projectKey: P, id: "g2", name: "B" });
    state = moveThreadsToGroup(state, ["t1"], "g1");
    state = moveThreadsToGroup(state, ["t1"], "g2");

    expect(state.threadGroupsById.g1!.threadKeys).toEqual([]);
    expect(state.threadGroupsById.g2!.threadKeys).toEqual(["t1"]);
    expect(state.groupIdByThreadKey.t1).toBe("g2");
  });

  it("moveThreadsToGroup inserts before the target thread for ordering", () => {
    let state = createThreadGroup(makeUiState(), {
      projectKey: P,
      id: "g1",
      name: "A",
      threadKeys: ["t1", "t2", "t3"],
    });
    state = moveThreadsToGroup(state, ["t3"], "g1", "t1");

    expect(state.threadGroupsById.g1!.threadKeys).toEqual(["t3", "t1", "t2"]);
  });

  it("moveThreadsToGroup with null target removes membership (back to ungrouped)", () => {
    let state = createThreadGroup(makeUiState(), {
      projectKey: P,
      id: "g1",
      name: "A",
      threadKeys: ["t1", "t2"],
    });
    state = moveThreadsToGroup(state, ["t1"], null);

    expect(state.threadGroupsById.g1!.threadKeys).toEqual(["t2"]);
    expect(state.groupIdByThreadKey).toEqual({ t2: "g1" });
  });

  it("deleteThreadGroup returns members to ungrouped and drops order/expanded entries", () => {
    let state = createThreadGroup(makeUiState(), {
      projectKey: P,
      id: "g1",
      name: "A",
      threadKeys: ["t1"],
    });
    state = setThreadGroupExpanded(state, "g1", false);
    state = deleteThreadGroup(state, "g1");

    expect(state.threadGroupsById).toEqual({});
    expect(state.threadGroupOrderByProjectKey).toEqual({});
    expect(state.threadGroupExpandedById).toEqual({});
    expect(state.groupIdByThreadKey).toEqual({});
  });

  it("renameThreadGroup trims and ignores empty names", () => {
    let state = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "A" });
    state = renameThreadGroup(state, "g1", "  PRs in review  ");
    expect(state.threadGroupsById.g1!.name).toBe("PRs in review");
    expect(renameThreadGroup(state, "g1", "   ")).toBe(state);
  });

  it("toggleThreadGroup flips collapse, defaulting to expanded", () => {
    let state = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "A" });
    state = toggleThreadGroup(state, "g1");
    expect(state.threadGroupExpandedById.g1).toBe(false);
    state = toggleThreadGroup(state, "g1");
    expect(state.threadGroupExpandedById.g1).toBe(true);
  });

  it("reorderThreadGroups moves a folder before another within the project", () => {
    let state = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "A" });
    state = createThreadGroup(state, { projectKey: P, id: "g2", name: "B" });
    state = createThreadGroup(state, { projectKey: P, id: "g3", name: "C" });
    state = reorderThreadGroups(state, P, "g3", "g1");
    expect(state.threadGroupOrderByProjectKey[P]).toEqual(["g3", "g1", "g2"]);
  });

  it("syncThreadGroups prunes dead threads and drops empty folders in dead projects", () => {
    let state = createThreadGroup(makeUiState(), {
      projectKey: P,
      id: "g1",
      name: "A",
      threadKeys: ["t1", "t2"],
    });
    state = createThreadGroup(state, { projectKey: "dead-proj", id: "g2", name: "B" });

    const next = syncThreadGroups(state, {
      liveThreadKeys: new Set(["t1"]),
      liveProjectKeys: new Set([P]),
    });

    expect(next.threadGroupsById.g1!.threadKeys).toEqual(["t1"]);
    expect(next.threadGroupsById.g2).toBeUndefined();
    expect(next.groupIdByThreadKey).toEqual({ t1: "g1" });
  });

  it("syncThreadGroups keeps empty folders that belong to a live project", () => {
    const state = createThreadGroup(makeUiState(), { projectKey: P, id: "g1", name: "A" });
    const next = syncThreadGroups(state, {
      liveThreadKeys: new Set<string>(),
      liveProjectKeys: new Set([P]),
    });
    expect(next).toBe(state);
  });
});

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("uiStateStore persistence round-trip", () => {
  let localStorageStub: Storage;

  beforeEach(() => {
    localStorageStub = createLocalStorageStub();
    vi.stubGlobal("window", { localStorage: localStorageStub });
    vi.stubGlobal("localStorage", localStorageStub);
    // Reset module-level persistence state so tests don't bleed into each other.
    hydratePersistedProjectState({ collapsedProjectCwds: [], expandedProjectCwds: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves all-collapsed project state across restart", () => {
    // Regression: pre-fix, persistState only wrote `expandedProjectCwds`, so
    // an empty array on rehydrate was indistinguishable from a fresh install
    // and the syncProjects fallback re-expanded every row.
    const projectA = { key: "kA", logicalKey: "kA", cwd: "/projA" };
    const projectB = { key: "kB", logicalKey: "kB", cwd: "/projB" };

    let state = syncProjects(makeUiState(), [projectA, projectB]);
    state = setProjectExpanded(state, projectA.key, false);
    state = setProjectExpanded(state, projectB.key, false);
    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    hydratePersistedProjectState(persisted);
    const rehydrated = syncProjects(makeUiState(), [projectA, projectB]);

    expect(rehydrated.projectExpandedById).toEqual({
      [projectA.key]: false,
      [projectB.key]: false,
    });
  });

  it("respects mixed expand state on rehydrate and defaults new projects to expanded", () => {
    const projectA = { key: "kA", logicalKey: "kA", cwd: "/projA" };
    const projectB = { key: "kB", logicalKey: "kB", cwd: "/projB" };
    const projectC = { key: "kC", logicalKey: "kC", cwd: "/projC" };

    let state = syncProjects(makeUiState(), [projectA, projectB]);
    state = setProjectExpanded(state, projectB.key, false);
    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    hydratePersistedProjectState(persisted);
    const rehydrated = syncProjects(makeUiState(), [projectA, projectB, projectC]);

    expect(rehydrated.projectExpandedById).toEqual({
      [projectA.key]: true,
      [projectB.key]: false,
      [projectC.key]: true,
    });
  });

  it("preserves legacy not-in-expanded-list = collapsed for one upgrade session", () => {
    // Pre-fix shape only stored expandedProjectCwds. Absence of
    // collapsedProjectCwds opts the session into the legacy fallback so
    // upgrade users do not see previously collapsed rows pop open.
    hydratePersistedProjectState({
      expandedProjectCwds: ["/projA"],
    });

    const rehydrated = syncProjects(makeUiState(), [
      { key: "kA", logicalKey: "kA", cwd: "/projA" },
      { key: "kB", logicalKey: "kB", cwd: "/projB" },
    ]);

    expect(rehydrated.projectExpandedById).toEqual({
      kA: true,
      kB: false,
    });
  });

  it("preserves manual project order across restart", () => {
    const projectA = { key: "kOrderA", logicalKey: "kOrderA", cwd: "/order-projA" };
    const projectB = { key: "kOrderB", logicalKey: "kOrderB", cwd: "/order-projB" };
    const projectC = { key: "kOrderC", logicalKey: "kOrderC", cwd: "/order-projC" };

    let state = syncProjects(makeUiState(), [projectA, projectB, projectC]);
    state = reorderProjects(state, [projectC.key], [projectA.key]);
    expect(state.projectOrder).toEqual([projectC.key, projectA.key, projectB.key]);
    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(persisted.projectOrderCwds).toEqual([projectC.cwd, projectA.cwd, projectB.cwd]);

    hydratePersistedProjectState(persisted);
    // Fresh state (empty projectOrder) so syncProjects derives order from
    // persistedProjectOrderCwds rather than the in-memory projectOrder branch.
    const rehydrated = syncProjects(makeUiState(), [projectA, projectB, projectC]);

    expect(rehydrated.projectOrder).toEqual([projectC.key, projectA.key, projectB.key]);
  });

  it("persists the default advertised endpoint preference", () => {
    const state = setDefaultAdvertisedEndpointKey(makeUiState(), "desktop-core:lan:http");

    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(persisted.defaultAdvertisedEndpointKey).toBe("desktop-core:lan:http");
  });

  it("preserves expand state across restart when project's logical key changes", () => {
    // After restart, in-memory previousExpandedById is empty, so the
    // previousLogicalKey-to-state bridge in syncProjects cannot help. The
    // persisted-cwd fallback is the only mechanism that can carry collapse
    // state across a restart that also flips a project into a new logical
    // group (e.g. late-arriving repo metadata). This locks in that path.
    const physicalKey = "env-local:/lk-restart-proj";
    const previousLogicalKey = physicalKey;
    const cwd = "/lk-restart-proj";

    let state = syncProjects(makeUiState(), [
      { key: physicalKey, logicalKey: previousLogicalKey, cwd },
    ]);
    state = setProjectExpanded(state, previousLogicalKey, false);
    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    hydratePersistedProjectState(persisted);

    const nextLogicalKey = "lk-restart-canonical";
    const rehydrated = syncProjects(makeUiState(), [
      { key: physicalKey, logicalKey: nextLogicalKey, cwd },
    ]);

    expect(rehydrated.projectExpandedById[nextLogicalKey]).toBe(false);
  });

  it("round-trips thread folders (membership, order, collapse) across restart", () => {
    let state = createThreadGroup(makeUiState(), {
      projectKey: "proj-A",
      id: "g1",
      name: "PRs in review",
      threadKeys: ["env:t1", "env:t2"],
    });
    state = createThreadGroup(state, { projectKey: "proj-A", id: "g2", name: "Experiments" });
    state = reorderThreadGroups(state, "proj-A", "g2", "g1");
    state = setThreadGroupExpanded(state, "g1", false);
    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(persisted.threadGroupOrderByProjectKey).toEqual({ "proj-A": ["g2", "g1"] });
    expect(persisted.collapsedThreadGroupIds).toEqual(["g1"]);

    const rehydrated = sanitizePersistedThreadGroups(persisted);
    expect(rehydrated.threadGroupsById.g1!.threadKeys).toEqual(["env:t1", "env:t2"]);
    expect(rehydrated.threadGroupOrderByProjectKey).toEqual({ "proj-A": ["g2", "g1"] });
    expect(rehydrated.threadGroupExpandedById).toEqual({ g1: false });
    expect(rehydrated.groupIdByThreadKey).toEqual({ "env:t1": "g1", "env:t2": "g1" });
  });
});
