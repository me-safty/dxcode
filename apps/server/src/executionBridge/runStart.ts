import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ExecutionRunCreateRequest,
  type ExecutionRunCreateResponse,
  type ExecutionRunLifecycleEvent,
  MessageId,
  type ModelSelection,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

import { getAutoBootstrapDefaultModelSelection } from "../serverRuntimeStartup.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export type ExecutionLifecycleCheckpoint = "started" | "completed" | "failed";

export interface TrackedExecutionRun {
  readonly controlThreadId: string;
  readonly executionRunId: string;
  readonly threadId: ThreadId;
  readonly startedEventId: string | null;
  readonly completedEventId: string | null;
  readonly failedEventId: string | null;
  readonly lastTurnId: TurnId | null;
}

interface ExecutionBridgeRunRegistryShape {
  readonly trackAcceptedRun: (
    input: Pick<TrackedExecutionRun, "controlThreadId" | "executionRunId" | "threadId">,
  ) => Effect.Effect<void, never, never>;
  readonly getTrackedRun: (
    threadId: ThreadId,
  ) => Effect.Effect<TrackedExecutionRun | null, never, never>;
  readonly markLifecycleDelivered: (
    input: Pick<TrackedExecutionRun, "threadId"> & {
      readonly type: ExecutionLifecycleCheckpoint;
      readonly eventId: string;
      readonly turnId?: TurnId;
    },
  ) => Effect.Effect<void, never, never>;
}

export class ExecutionBridgeRunRegistry extends Context.Service<
  ExecutionBridgeRunRegistry,
  ExecutionBridgeRunRegistryShape
>()("t3/executionBridge/ExecutionBridgeRunRegistry") {}

function deriveProjectTitle(workspaceRoot: string) {
  const segments = workspaceRoot.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? "project";
}

function deriveThreadTitle(input: ExecutionRunCreateRequest) {
  const trimmedTitle = input.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }
  return `Run ${input.controlThreadId}`;
}

function resolveModelSelection(
  request: ExecutionRunCreateRequest,
  existingProjectDefault: ModelSelection | null,
) {
  return (
    request.modelSelection ?? existingProjectDefault ?? getAutoBootstrapDefaultModelSelection()
  );
}

const makeExecutionBridgeRunRegistry = Effect.gen(function* () {
  const state = yield* Ref.make(new Map<string, TrackedExecutionRun>());

  const trackAcceptedRun: ExecutionBridgeRunRegistryShape["trackAcceptedRun"] = (input) =>
    Ref.update(state, (current) => {
      const next = new Map(current);
      next.set(String(input.threadId), {
        controlThreadId: input.controlThreadId,
        executionRunId: input.executionRunId,
        threadId: input.threadId,
        startedEventId: null,
        completedEventId: null,
        failedEventId: null,
        lastTurnId: null,
      });
      return next;
    });

  const getTrackedRun: ExecutionBridgeRunRegistryShape["getTrackedRun"] = (threadId) =>
    Ref.get(state).pipe(Effect.map((current) => current.get(String(threadId)) ?? null));

  const markLifecycleDelivered: ExecutionBridgeRunRegistryShape["markLifecycleDelivered"] = (
    input,
  ) =>
    Ref.update(state, (current) => {
      const tracked = current.get(String(input.threadId));
      if (!tracked) {
        return current;
      }

      const next = new Map(current);
      next.set(String(input.threadId), {
        ...tracked,
        startedEventId: input.type === "started" ? input.eventId : tracked.startedEventId,
        completedEventId: input.type === "completed" ? input.eventId : tracked.completedEventId,
        failedEventId: input.type === "failed" ? input.eventId : tracked.failedEventId,
        lastTurnId: input.turnId ?? tracked.lastTurnId,
      });
      return next;
    });

  return {
    trackAcceptedRun,
    getTrackedRun,
    markLifecycleDelivered,
  } satisfies ExecutionBridgeRunRegistryShape;
});

export const ExecutionBridgeRunRegistryLive = Layer.effect(
  ExecutionBridgeRunRegistry,
  makeExecutionBridgeRunRegistry,
);

export class ExecutionBridgeRunStartError extends Schema.TaggedErrorClass<ExecutionBridgeRunStartError>()(
  "ExecutionBridgeRunStartError",
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

export const startExecutionRun = (request: ExecutionRunCreateRequest) =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const runRegistry = yield* ExecutionBridgeRunRegistry;
    const now = new Date().toISOString();

    const existingProject = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(
      request.workspaceRoot,
    );

    const projectId = Option.isSome(existingProject)
      ? existingProject.value.id
      : ProjectId.make(crypto.randomUUID());
    const modelSelection = resolveModelSelection(
      request,
      Option.isSome(existingProject) ? existingProject.value.defaultModelSelection : null,
    );

    if (Option.isNone(existingProject)) {
      yield* orchestrationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make(`execution-bridge:project:create:${request.executionRunId}`),
        projectId,
        title: deriveProjectTitle(request.workspaceRoot),
        workspaceRoot: request.workspaceRoot,
        defaultModelSelection: modelSelection,
        createdAt: now,
      });
    }

    const threadId = ThreadId.make(crypto.randomUUID());
    yield* orchestrationEngine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`execution-bridge:thread:create:${request.executionRunId}`),
      threadId,
      projectId,
      title: deriveThreadTitle(request),
      modelSelection,
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: now,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`execution-bridge:turn:start:${request.executionRunId}`),
      threadId,
      message: {
        messageId: MessageId.make(`execution-run:${request.executionRunId}`),
        role: "user",
        text: request.initialPrompt,
        attachments: [],
      },
      modelSelection,
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt: now,
    });

    // We track the accepted run by thread id so the lifecycle watcher can map later
    // session updates back to the originating orchestrator execution run.
    yield* runRegistry.trackAcceptedRun({
      controlThreadId: request.controlThreadId,
      executionRunId: request.executionRunId,
      threadId,
    });

    return {
      controlThreadId: request.controlThreadId,
      executionRunId: request.executionRunId,
      t3ThreadId: threadId,
      acceptedAt: now,
    } satisfies ExecutionRunCreateResponse;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ExecutionBridgeRunStartError({
          message:
            cause instanceof Error ? cause.message : "Failed to dispatch execution bridge run.",
          status: 400,
        }),
    ),
  );

export function buildLifecycleEvent(input: {
  readonly trackedRun: TrackedExecutionRun;
  readonly type: ExecutionLifecycleCheckpoint;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly t3TurnId?: TurnId;
  readonly failureSummary?: string;
}): ExecutionRunLifecycleEvent {
  return {
    eventId: input.eventId,
    controlThreadId: input.trackedRun.controlThreadId,
    executionRunId: input.trackedRun.executionRunId,
    type: input.type,
    occurredAt: input.occurredAt,
    t3ThreadId: input.trackedRun.threadId,
    ...((input.t3TurnId ?? input.trackedRun.lastTurnId)
      ? { t3TurnId: input.t3TurnId ?? input.trackedRun.lastTurnId! }
      : {}),
    ...(input.failureSummary ? { failureSummary: input.failureSummary } : {}),
  };
}
