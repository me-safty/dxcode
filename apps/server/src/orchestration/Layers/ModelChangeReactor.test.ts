import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { ModelChangeReactorLive } from "./ModelChangeReactor.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ModelChangeReactor } from "../Services/ModelChangeReactor.ts";
import { ServerConfig } from "../../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

async function waitForActivity(
  engine: OrchestrationEngineShape,
  predicate: (activity: OrchestrationThreadActivity) => boolean,
  timeoutMs = 2000,
): Promise<OrchestrationThreadActivity> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<OrchestrationThreadActivity> => {
    const readModel = await Effect.runPromise(engine.getReadModel());
    const activities =
      readModel.threads.find((thread) => thread.id === "thread-1")?.activities ?? [];
    const match = activities.find(predicate);
    if (match) {
      return match;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for model change activity");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };
  return poll();
}

describe("ModelChangeReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ModelChangeReactor,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function createHarness() {
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const layer = ModelChangeReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reactor = await runtime.runPromise(Effect.service(ModelChangeReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project-1",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: asThreadId("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    return { engine, reactor };
  }

  it("appends a user-triggered model change notice activity", async () => {
    const { engine } = await createHarness();

    await Effect.runPromise(
      engine.dispatch({
        type: "thread.model.set",
        commandId: CommandId.makeUnsafe("cmd-model-set-user"),
        threadId: asThreadId("thread-1"),
        model: "gpt-5.4",
        source: "client",
      }),
    );

    const activity = await waitForActivity(
      engine,
      (entry) => entry.kind === "thread.model.changed" && entry.summary === "Model changed",
    );

    expect(activity.payload).toMatchObject({
      fromModel: "gpt-5-codex",
      toModel: "gpt-5.4",
      source: "user",
    });
  });

  it("appends a provider-reroute notice with reason", async () => {
    const { engine } = await createHarness();

    await Effect.runPromise(
      engine.dispatch({
        type: "thread.model.set",
        commandId: CommandId.makeUnsafe("cmd-model-set-reroute"),
        threadId: asThreadId("thread-1"),
        model: "gpt-5.4-mini",
        source: "provider-reroute",
        reason: "capacity",
      }),
    );

    const activity = await waitForActivity(
      engine,
      (entry) =>
        entry.kind === "thread.model.changed" &&
        typeof (entry.payload as { reason?: unknown }).reason === "string",
    );

    expect(activity.payload).toMatchObject({
      fromModel: "gpt-5-codex",
      toModel: "gpt-5.4-mini",
      source: "provider-reroute",
      reason: "capacity",
    });
  });

  it("does not append a notice when the model does not change", async () => {
    const { engine, reactor } = await createHarness();

    await Effect.runPromise(
      engine.dispatch({
        type: "thread.model.set",
        commandId: CommandId.makeUnsafe("cmd-model-set-noop"),
        threadId: asThreadId("thread-1"),
        model: "gpt-5-codex",
        source: "client",
      }),
    );
    await Effect.runPromise(reactor.drain);

    const readModel = await Effect.runPromise(engine.getReadModel());
    expect(readModel.threads.find((thread) => thread.id === "thread-1")?.activities ?? []).toEqual(
      [],
    );
  });
});
