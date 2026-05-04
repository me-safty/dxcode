import { EnvironmentId, type OrchestrationCommand } from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import {
  ExecutionBridgeRunRegistry,
  ExecutionBridgeRunRegistryLive,
  ensureTaskPullRequest,
  materializeTaskRuntime,
} from "./runStart.ts";
import { SandboxProviderRegistryLive } from "../sandbox/Layers/SandboxProviderRegistryLive.ts";
import { SandboxRuntimeLive } from "../sandbox/Layers/SandboxRuntimeLive.ts";
import { GitVcsDriver, type GitVcsDriverShape } from "../vcs/GitVcsDriver.ts";
import { GitManager, type GitManagerShape } from "../git/GitManager.ts";

const materializeRequest = {
  taskId: "task-1",
  workSessionId: "work-session-1",
  initialPrompt: "Investigate the login failure",
  title: "Fix login",
  runtimeMode: "full-access",
  interactionMode: "default",
  startCodingAgent: true,
  idempotencyKey: "sandbox:local:task-1:work-session-1",
  sandbox: {
    providerKind: "local",
  },
  services: [
    {
      kind: "t3-runtime",
      required: true,
    },
  ],
  project: {
    repoName: "t3code",
    workspaceRoot: "/repo/t3code",
    defaultBranch: "main",
  },
} as const;

function makeTestLayer(commands: OrchestrationCommand[]) {
  const createWorktree = vi.fn(() =>
    Effect.succeed({
      worktree: {
        path: "/repo/t3code/.worktrees/fix-login",
        refName: "task/fix-login-task-1",
      },
    }),
  );

  const layer = SandboxRuntimeLive.pipe(
    Layer.provideMerge(SandboxProviderRegistryLive),
    Layer.provideMerge(ExecutionBridgeRunRegistryLive),
    Layer.provideMerge(
      Layer.succeed(GitVcsDriver, {
        createWorktree,
      } as unknown as GitVcsDriverShape),
    ),
    Layer.provideMerge(
      Layer.succeed(ServerEnvironment, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("local-env")),
        getDescriptor: Effect.succeed({
          environmentId: EnvironmentId.make("local-env"),
          label: "Local",
          platform: {
            os: "darwin" as const,
            arch: "arm64" as const,
          },
          serverVersion: "test",
          capabilities: {
            repositoryIdentity: true,
          },
        }),
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(ProjectionSnapshotQuery, {
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      } as unknown as ProjectionSnapshotQueryShape),
    ),
    Layer.provideMerge(
      Layer.succeed(OrchestrationEngineService, {
        dispatch: (command) => {
          commands.push(command);
          return Effect.succeed({ sequence: commands.length });
        },
        getReadModel: () => Effect.die("getReadModel should not be called"),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
      } satisfies OrchestrationEngineShape),
    ),
  );

  return { layer, createWorktree };
}

describe("materializeTaskRuntime", () => {
  it("returns local Sandbox descriptors and reuses duplicate materialization keys", async () => {
    const commands: OrchestrationCommand[] = [];
    const { layer, createWorktree } = makeTestLayer(commands);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* materializeTaskRuntime(materializeRequest);
        const tracked = yield* (yield* ExecutionBridgeRunRegistry).getTrackedRun(first.t3ThreadId);
        const second = yield* materializeTaskRuntime(materializeRequest);
        return { first, second, tracked };
      }).pipe(Effect.provide(layer)),
    );

    expect(createWorktree).toHaveBeenCalledTimes(1);
    expect(commands.map((command) => command.type)).toEqual([
      "project.create",
      "thread.create",
      "thread.turn.start",
    ]);
    expect(result.second).toEqual(result.first);
    expect(result.first.sandbox?.providerKind).toBe("local");
    expect(result.first.sandbox?.worktree?.branch).toBe("task/fix-login-task-1");
    expect(result.first.environment?.environmentId).toBe("local-env");
    expect(result.first.services?.[0]?.kind).toBe("t3-runtime");
    expect(result.tracked?.kind).toBe("task");
    expect(result.tracked?.threadId).toBe(result.first.t3ThreadId);
  });

  it("preserves no-agent materialization by creating a Thread without starting a turn", async () => {
    const commands: OrchestrationCommand[] = [];
    const { layer } = makeTestLayer(commands);

    const result = await Effect.runPromise(
      materializeTaskRuntime({
        ...materializeRequest,
        workSessionId: "work-session-no-agent",
        startCodingAgent: false,
        idempotencyKey: "sandbox:local:task-1:work-session-no-agent",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.sandbox?.providerKind).toBe("local");
    expect(commands.map((command) => command.type)).toEqual(["project.create", "thread.create"]);
  });
});

const taskPullRequestEnsureRequest = {
  taskId: "task-1",
  workSessionId: "work-session-1",
  branch: "task/fix-login-task-1",
  worktreePath: "/repo/t3code/.worktrees/fix-login",
  project: {
    githubOwner: "affil-ai",
    githubRepo: "t3code",
    defaultBranch: "affil/mvp-deployment",
  },
  title: "Fix login",
  idempotencyKey: "task-pr:task-1:work-session-1:task/fix-login-task-1",
} as const;

function makeTaskPrTestLayer(input: {
  readonly revListCount: number;
  readonly hasWorkingTreeChanges?: boolean;
  readonly runStackedAction?: GitManagerShape["runStackedAction"];
  readonly initialBranch?: string;
}) {
  let currentBranch = input.initialBranch ?? "task/fix-login-task-1";
  const execute = vi.fn((request: { readonly args: ReadonlyArray<string> }) => {
    if (request.args[0] === "checkout" && request.args[1] === "-B") {
      currentBranch = String(request.args[2]);
    }
    if (request.args[0] === "rev-list") {
      return Effect.succeed({
        exitCode: 0,
        stdout: `${input.revListCount}\n`,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    }
    return Effect.succeed({
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });
  const statusDetails = vi.fn(() =>
    Effect.succeed({
      isRepo: true,
      hasOriginRemote: true,
      isDefaultBranch: false,
      branch: currentBranch,
      upstreamRef: `origin/${currentBranch}`,
      hasWorkingTreeChanges: input.hasWorkingTreeChanges ?? false,
      workingTree: {
        changedFiles: [],
        insertions: 0,
        deletions: 0,
        untracked: 0,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: input.revListCount,
    }),
  );
  const runStackedAction =
    input.runStackedAction ??
    vi.fn(() => Effect.die("runStackedAction should not be called without committed changes"));

  const layer = Layer.mergeAll(
    Layer.succeed(GitVcsDriver, {
      execute,
      statusDetails,
    } as unknown as GitVcsDriverShape),
    Layer.succeed(GitManager, {
      runStackedAction,
    } as unknown as GitManagerShape),
  );

  return { layer, execute, runStackedAction };
}

describe("ensureTaskPullRequest", () => {
  it("waits instead of creating a PR for an upstream branch with no committed diff", async () => {
    const { layer, execute, runStackedAction } = makeTaskPrTestLayer({ revListCount: 0 });

    const result = await Effect.runPromise(
      ensureTaskPullRequest(taskPullRequestEnsureRequest).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("waiting_for_changes");
    expect(runStackedAction).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["config", "branch.task/fix-login-task-1.gh-merge-base", "affil/mvp-deployment"],
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["rev-list", "--count", "affil/mvp-deployment..HEAD"],
      }),
    );
  });

  it("creates a draft PR against the project default branch when committed changes exist", async () => {
    const runStackedAction = vi.fn(() =>
      Effect.succeed({
        action: "create_pr" as const,
        branch: { status: "skipped_not_requested" as const },
        commit: { status: "skipped_not_requested" as const },
        push: { status: "skipped_not_requested" as const },
        pr: {
          status: "created" as const,
          url: "https://github.com/affil-ai/t3code/pull/123",
          number: 123,
          baseBranch: "affil/mvp-deployment",
          headBranch: "task/fix-login-task-1",
          title: "Fix login",
        },
        toast: {
          title: "Pull request created",
          cta: { kind: "none" as const },
        },
      }),
    );
    const { layer } = makeTaskPrTestLayer({ revListCount: 1, runStackedAction });

    const result = await Effect.runPromise(
      ensureTaskPullRequest(taskPullRequestEnsureRequest).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("created");
    if (result.status !== "created" && result.status !== "existing") {
      throw new Error("Expected a pull request result.");
    }
    expect(result.pullRequest?.url).toBe("https://github.com/affil-ai/t3code/pull/123");
    expect(result.pullRequest?.baseBranch).toBe("affil/mvp-deployment");
    expect(runStackedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_pr",
        cwd: taskPullRequestEnsureRequest.worktreePath,
      }),
      expect.objectContaining({ draftPullRequest: true }),
    );
  });

  it("reattaches agent-created branches to the orchestrator branch before opening a PR", async () => {
    const runStackedAction = vi.fn(() =>
      Effect.succeed({
        action: "create_pr" as const,
        branch: { status: "skipped_not_requested" as const },
        commit: { status: "skipped_not_requested" as const },
        push: { status: "skipped_not_requested" as const },
        pr: {
          status: "created" as const,
          url: "https://github.com/affil-ai/t3code/pull/124",
          number: 124,
          baseBranch: "affil/mvp-deployment",
          headBranch: "task/fix-login-task-1",
          title: "Fix login",
        },
        toast: {
          title: "Pull request created",
          cta: { kind: "none" as const },
        },
      }),
    );
    const { layer, execute } = makeTaskPrTestLayer({
      revListCount: 1,
      initialBranch: "task/agent-created-branch",
      runStackedAction,
    });

    const result = await Effect.runPromise(
      ensureTaskPullRequest(taskPullRequestEnsureRequest).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("created");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["checkout", "-B", "task/fix-login-task-1"],
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["config", "branch.task/fix-login-task-1.gh-merge-base", "affil/mvp-deployment"],
      }),
    );
  });

  it("extracts a PR URL from noisy source control output", async () => {
    const runStackedAction = vi.fn(() =>
      Effect.succeed({
        action: "create_pr" as const,
        branch: { status: "skipped_not_requested" as const },
        commit: { status: "skipped_not_requested" as const },
        push: { status: "skipped_not_requested" as const },
        pr: {
          status: "created" as const,
          url: "Pull request created: https://github.com/affil-ai/t3code/pull/456",
          baseBranch: "affil/mvp-deployment",
          headBranch: "task/fix-login-task-1",
          title: "Fix login",
        },
        toast: {
          title: "Pull request created",
          cta: { kind: "none" as const },
        },
      }),
    );
    const { layer } = makeTaskPrTestLayer({ revListCount: 1, runStackedAction });

    const result = await Effect.runPromise(
      ensureTaskPullRequest(taskPullRequestEnsureRequest).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("created");
    if (result.status !== "created" && result.status !== "existing") {
      throw new Error("Expected a pull request result.");
    }
    expect(result.pullRequest?.number).toBe(456);
    expect(result.pullRequest?.url).toBe("https://github.com/affil-ai/t3code/pull/456");
  });
});
