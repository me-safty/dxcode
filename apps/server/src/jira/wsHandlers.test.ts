import {
  CommandId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  ProjectId,
  ThreadId,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionThreadJira } from "../persistence/Services/ProjectionThreadJira.ts";
import { type ForkJiraHandlerDeps, makeForkJiraHandlers } from "./wsHandlers.ts";

const THREAD = ThreadId.make("thread-1");
const PROJECT = ProjectId.make("project-1");

const makeThreadShell = (over: {
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly title?: string;
}): OrchestrationThreadShell =>
  ({
    id: THREAD,
    projectId: PROJECT,
    title: over.title ?? "Fix login flow",
    branch: over.branch ?? null,
    worktreePath: over.worktreePath ?? null,
  }) as unknown as OrchestrationThreadShell;

const makeProjectShell = (workspaceRoot: string): OrchestrationProjectShell =>
  ({ id: PROJECT, workspaceRoot }) as unknown as OrchestrationProjectShell;

const makeLocalStatus = (refName: string | null): VcsStatusLocalResult =>
  ({ refName }) as unknown as VcsStatusLocalResult;

interface Harness {
  readonly deps: ForkJiraHandlerDeps;
  readonly dispatched: Array<OrchestrationCommand>;
  readonly upserts: Array<ProjectionThreadJira>;
  readonly deletes: Array<ThreadId>;
}

const makeHarness = (over?: {
  readonly projectKey?: string | null;
  readonly thread?: OrchestrationThreadShell;
  readonly localRefName?: string | null;
}): Harness => {
  const dispatched: Array<OrchestrationCommand> = [];
  const upserts: Array<ProjectionThreadJira> = [];
  const deletes: Array<ThreadId> = [];
  const thread =
    over?.thread ?? makeThreadShell({ worktreePath: "/wt", branch: "empcode/abcd1234" });

  const deps: ForkJiraHandlerDeps = {
    projectKey: over?.projectKey ?? null,
    newCommandId: () => Effect.succeed(CommandId.make("server:test:cmd")),
    gitWorkflow: {
      localStatus: () => Effect.succeed(makeLocalStatus(over?.localRefName ?? "main")),
      renameBranch: ({ newBranch }) => Effect.succeed({ branch: newBranch }),
      invalidateStatus: () => Effect.void,
    },
    orchestrationEngine: {
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: dispatched.length };
        }),
    },
    projectionSnapshotQuery: {
      getThreadShellById: () => Effect.succeed(Option.some(thread)),
      getProjectShellById: () => Effect.succeed(Option.some(makeProjectShell("/repo"))),
    },
    jiraRepository: {
      upsert: (row) =>
        Effect.sync(() => {
          upserts.push(row);
        }),
      getByThreadId: () => Effect.succeed(Option.none()),
      listAll: () => Effect.succeed([]),
      deleteByThreadId: ({ threadId }) =>
        Effect.sync(() => {
          deletes.push(threadId);
        }),
    },
  };

  return { deps, dispatched, upserts, deletes };
};

it.effect("renames a temp worktree branch and persists the key", () =>
  Effect.gen(function* () {
    const h = makeHarness({
      projectKey: "PLAT",
      thread: makeThreadShell({
        worktreePath: "/wt",
        branch: "empcode/abcd1234",
        title: "Fix login flow",
      }),
    });
    const result = yield* makeForkJiraHandlers(h.deps).setThreadJiraKey({
      threadId: THREAD,
      jiraKey: "PLAT-1",
      renameBranch: true,
    });

    assert.strictEqual(result.jiraKey, "PLAT-1");
    assert.strictEqual(result.branch, "PLAT-1/fix-login-flow");
    assert.deepStrictEqual(
      h.dispatched.map((c) => c.type),
      ["thread.meta.update"],
    );
    assert.strictEqual(h.upserts.length, 1);
    assert.strictEqual(h.upserts[0]?.jiraKey, "PLAT-1");
  }),
);

it.effect("rejects a key that does not match the configured project key", () =>
  Effect.gen(function* () {
    const h = makeHarness({ projectKey: "PLAT" });
    const outcome = yield* Effect.result(
      makeForkJiraHandlers(h.deps).setThreadJiraKey({
        threadId: THREAD,
        jiraKey: "OTHER-1",
        renameBranch: false,
      }),
    );
    assert.isTrue(outcome._tag === "Failure");
    if (outcome._tag === "Failure") {
      assert.include(outcome.failure.message, "Use a Jira key like PLAT-123.");
    }
    assert.strictEqual(h.upserts.length, 0);
  }),
);

it.effect("blocks setting a key on a non-worktree thread checked out on main", () =>
  Effect.gen(function* () {
    const h = makeHarness({
      thread: makeThreadShell({ worktreePath: null, branch: "main" }),
      localRefName: "main",
    });
    const outcome = yield* Effect.result(
      makeForkJiraHandlers(h.deps).setThreadJiraKey({
        threadId: THREAD,
        jiraKey: "PLAT-1",
        renameBranch: false,
      }),
    );
    assert.isTrue(outcome._tag === "Failure");
    if (outcome._tag === "Failure") {
      assert.include(
        outcome.failure.message,
        "worktree threads or when the current checkout is not main",
      );
    }
    assert.strictEqual(h.upserts.length, 0);
  }),
);

it.effect("allows a key on a non-worktree thread checked out on a feature branch", () =>
  Effect.gen(function* () {
    const h = makeHarness({
      thread: makeThreadShell({ worktreePath: null, branch: "feature/foo" }),
      localRefName: "feature/foo",
    });
    const result = yield* makeForkJiraHandlers(h.deps).setThreadJiraKey({
      threadId: THREAD,
      jiraKey: "ABC-7",
      renameBranch: false,
    });
    assert.strictEqual(result.jiraKey, "ABC-7");
    // renameBranch=false → no git rename / dispatch
    assert.strictEqual(h.dispatched.length, 0);
    assert.strictEqual(h.upserts.length, 1);
  }),
);

it.effect("clearing a key deletes the row and never renames", () =>
  Effect.gen(function* () {
    const h = makeHarness({
      thread: makeThreadShell({ worktreePath: "/wt", branch: "PLAT-1/fix-login-flow" }),
    });
    const result = yield* makeForkJiraHandlers(h.deps).setThreadJiraKey({
      threadId: THREAD,
      jiraKey: null,
      renameBranch: true,
    });
    assert.strictEqual(result.jiraKey, null);
    assert.strictEqual(h.deletes.length, 1);
    assert.strictEqual(h.dispatched.length, 0);
    assert.strictEqual(h.upserts.length, 0);
  }),
);
