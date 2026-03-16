import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  ProjectId,
  ThreadId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type SubagentRun,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { ServerConfig } from "../../config.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { RuntimeReceiptBus } from "../../orchestration/Services/RuntimeReceiptBus.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { SkillCatalog, type SkillCatalogShape } from "../Services/SkillCatalog.ts";
import { SubagentCoordinator } from "../Services/SubagentCoordinator.ts";
import { SubagentCoordinatorLive } from "./SubagentCoordinator.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("SubagentCoordinator", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | SubagentCoordinator,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const createdStateDirs = new Set<string>();

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const stateDir of createdStateDirs) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    createdStateDirs.clear();
  });

  it("detaches visible worktree threads when a retained subagent run is cleaned up", async () => {
    const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    const receiptPubSub = Effect.runSync(PubSub.unbounded<never>());
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Effect.void);
    const removeWorktree = vi.fn<GitCoreShape["removeWorktree"]>(() => Effect.void);
    const deleteLocalBranch = vi.fn<GitCoreShape["deleteLocalBranch"]>(() => Effect.void);

    const providerService: ProviderServiceShape = {
      startSession: () => Effect.die("unused"),
      sendTurn: () => Effect.die("unused"),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession,
      listSessions: () => Effect.succeed([] satisfies ReadonlyArray<ProviderSession>),
      getCapabilities: () =>
        Effect.succeed({
          sessionModelSwitch: "in-session",
        }),
      rollbackConversation: () => Effect.die("unused"),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    };

    const skillCatalog: SkillCatalogShape = {
      listSkills: () => Effect.succeed([]),
      getSkillById: () => Effect.die("unused"),
    };

    const git: Partial<GitCoreShape> = {
      removeWorktree,
      deleteLocalBranch,
    };
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-subagent-"));
    createdStateDirs.add(stateDir);

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );

    const managedRuntime = ManagedRuntime.make(
      SubagentCoordinatorLive.pipe(
        Layer.provideMerge(orchestrationLayer),
        Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
        Layer.provideMerge(Layer.succeed(GitCore, git as GitCoreShape)),
        Layer.provideMerge(Layer.succeed(SkillCatalog, skillCatalog)),
        Layer.provideMerge(
          Layer.succeed(RuntimeReceiptBus, {
            publish: () => Effect.void,
            stream: Stream.fromPubSub(receiptPubSub),
          }),
        ),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), stateDir)),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    runtime = managedRuntime;

    const engine = await managedRuntime.runPromise(Effect.service(OrchestrationEngineService));
    const coordinator = await managedRuntime.runPromise(Effect.service(SubagentCoordinator));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(coordinator.start.pipe(Scope.provide(scope)));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const createdAt = "2026-03-15T23:00:00.000Z";
    const projectId = asProjectId("project-1");
    const parentThreadId = asThreadId("thread-parent");
    const hiddenThreadId = asThreadId("thread-subagent");
    const visibleThreadId = asThreadId("thread-visible");
    const run: SubagentRun = {
      id: "run-1",
      parentThreadId,
      subagentThreadId: hiddenThreadId,
      skillId: "frontend-design",
      skillTitle: "Frontend Design",
      task: "Rewrite the homepage hero copy and update the UI.",
      status: "retained",
      branch: "t3code/subagent-frontend-design-run-1",
      worktreePath: "/tmp/subagent-worktree",
      report: null,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: createdAt,
      acceptedAt: createdAt,
    };

    await managedRuntime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId,
        title: "Project",
        workspaceRoot: "/tmp/project-root",
        defaultModel: "gpt-5.4",
        createdAt,
      }),
    );
    await managedRuntime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-parent"),
        threadId: parentThreadId,
        projectId,
        title: "Parent thread",
        model: "gpt-5.4",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        createdAt,
      }),
    );
    await managedRuntime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-hidden"),
        threadId: hiddenThreadId,
        projectId,
        title: "Hidden subagent thread",
        model: "gpt-5.4",
        runtimeMode: "full-access",
        interactionMode: "default",
        threadKind: "subagent",
        parentThreadId,
        branch: run.branch,
        worktreePath: run.worktreePath,
        createdAt,
      }),
    );
    await managedRuntime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-visible"),
        threadId: visibleThreadId,
        projectId,
        title: "Visible worktree thread",
        model: "gpt-5.4",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: run.branch,
        worktreePath: run.worktreePath,
        createdAt,
      }),
    );
    await managedRuntime.runPromise(
      engine.dispatch({
        type: "thread.subagent.upsert",
        commandId: CommandId.makeUnsafe("cmd-run-upsert"),
        threadId: parentThreadId,
        subagentRun: run,
        createdAt,
      }),
    );

    await managedRuntime.runPromise(
      engine.dispatch({
        type: "thread.subagent.cleanup",
        commandId: CommandId.makeUnsafe("cmd-run-cleanup"),
        threadId: parentThreadId,
        runId: run.id,
        createdAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await managedRuntime.runPromise(engine.getReadModel());
      const parentThread = readModel.threads.find((thread) => thread.id === parentThreadId);
      const visibleThread = readModel.threads.find((thread) => thread.id === visibleThreadId);
      const hiddenThread = readModel.threads.find((thread) => thread.id === hiddenThreadId);
      const cleanedRun = parentThread?.subagentRuns?.find((candidate) => candidate.id === run.id);
      return (
        visibleThread?.branch === null &&
        visibleThread.worktreePath === null &&
        hiddenThread?.deletedAt !== null &&
        hiddenThread?.deletedAt !== undefined &&
        cleanedRun?.status === "cleaned_up" &&
        cleanedRun.branch === null &&
        cleanedRun.worktreePath === null
      );
    });

    const readModel = await managedRuntime.runPromise(engine.getReadModel());
    const visibleThread = readModel.threads.find((thread) => thread.id === visibleThreadId);
    const parentThread = readModel.threads.find((thread) => thread.id === parentThreadId);
    const hiddenThread = readModel.threads.find((thread) => thread.id === hiddenThreadId);
    const cleanedRun = parentThread?.subagentRuns?.find((candidate) => candidate.id === run.id);

    expect(visibleThread).toMatchObject({
      id: visibleThreadId,
      branch: null,
      worktreePath: null,
    });
    expect(hiddenThread?.deletedAt).toEqual(expect.any(String));
    expect(cleanedRun).toMatchObject({
      id: run.id,
      status: "cleaned_up",
      branch: null,
      worktreePath: null,
    });
    expect(stopSession).toHaveBeenCalledWith({ threadId: hiddenThreadId });
    expect(removeWorktree).toHaveBeenCalledWith({
      cwd: "/tmp/project-root",
      path: run.worktreePath,
      force: true,
    });
    expect(deleteLocalBranch).toHaveBeenCalledWith({
      cwd: "/tmp/project-root",
      branch: run.branch,
      force: true,
    });
  });
});
