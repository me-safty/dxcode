import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type TaskRuntimeMaterializeRequest,
  type TaskRuntimeMaterializeResponse,
} from "@t3tools/contracts";
import {
  buildTaskMaterializationIdempotencyKey,
  type SandboxMaterializationResult,
} from "@t3tools/sandbox";
import { Deferred, Effect, Exit, Layer, Option, SynchronizedRef } from "effect";

import { modelSelectionFromOptionalProject } from "../../executionBridge/requestDefaults.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SandboxProviderRegistry } from "../Services/SandboxProviderRegistry.ts";
import {
  SandboxRuntime,
  sandboxRuntimeErrorFromUnknown,
  type SandboxRuntimeError,
  type SandboxRuntimeShape,
} from "../Services/SandboxRuntime.ts";

type MaterializationEntry =
  | {
      readonly status: "in-flight";
      readonly deferred: Deferred.Deferred<TaskRuntimeMaterializeResponse, SandboxRuntimeError>;
    }
  | {
      readonly status: "completed";
      readonly response: TaskRuntimeMaterializeResponse;
    };

type MaterializationDecision =
  | {
      readonly tag: "run";
    }
  | {
      readonly tag: "reuse";
      readonly entry: MaterializationEntry;
    };

function defaultSandboxServices(request: TaskRuntimeMaterializeRequest) {
  return request.services ?? [{ kind: "t3-runtime" as const, required: true }];
}

function resolveProviderKind(request: TaskRuntimeMaterializeRequest) {
  return request.sandbox?.providerKind ?? "local";
}

function resolveIdempotencyKey(request: TaskRuntimeMaterializeRequest) {
  const providerKind = resolveProviderKind(request);
  return (
    request.idempotencyKey ??
    buildTaskMaterializationIdempotencyKey({
      providerKind,
      taskId: request.taskId,
      workSessionId: request.workSessionId,
    })
  );
}

function materializationResponse(input: {
  readonly request: TaskRuntimeMaterializeRequest;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly providerResult: SandboxMaterializationResult;
  readonly acceptedAt: string;
}): TaskRuntimeMaterializeResponse {
  const worktree = input.providerResult.worktree;
  return {
    taskId: input.request.taskId,
    workSessionId: input.request.workSessionId,
    t3ProjectId: input.projectId,
    t3ThreadId: input.threadId,
    branch: worktree?.branch ?? null,
    worktreePath: worktree?.worktreePath ?? null,
    acceptedAt: input.acceptedAt,
    sandbox: input.providerResult.sandbox,
    environment: input.providerResult.environment,
    services: input.providerResult.services,
  };
}

function settleDeferred(
  deferred: Deferred.Deferred<TaskRuntimeMaterializeResponse, SandboxRuntimeError>,
  exit: Exit.Exit<TaskRuntimeMaterializeResponse, SandboxRuntimeError>,
) {
  return Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);
}

export const makeSandboxRuntime = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* SandboxProviderRegistry;
  const materializations = yield* SynchronizedRef.make(new Map<string, MaterializationEntry>());

  const materializeFresh = (request: TaskRuntimeMaterializeRequest, idempotencyKey: string) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const providerKind = resolveProviderKind(request);
      const provider = yield* providerRegistry.get(providerKind);

      const existingProject = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(
        request.project.workspaceRoot,
      );
      const projectId = Option.isSome(existingProject)
        ? existingProject.value.id
        : ProjectId.make(crypto.randomUUID());
      const modelSelection = modelSelectionFromOptionalProject(request, existingProject);

      if (Option.isNone(existingProject)) {
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`task-runtime:project:create:${request.taskId}`),
          projectId,
          title: request.project.repoName,
          workspaceRoot: request.project.workspaceRoot,
          defaultModelSelection: modelSelection,
          createdAt: now,
        });
      }

      const providerResult = yield* provider.materializeTaskRuntime({
        taskId: request.taskId,
        workSessionId: request.workSessionId,
        title: request.title,
        initialPrompt: request.initialPrompt,
        project: {
          repoName: request.project.repoName,
          workspaceRoot: request.project.workspaceRoot,
          defaultBranch: request.project.defaultBranch,
          ...(request.project.projectKey !== undefined
            ? { projectKey: request.project.projectKey }
            : {}),
        },
        ...(request.sandbox?.resources !== undefined
          ? { resources: request.sandbox.resources }
          : {}),
        services: defaultSandboxServices(request),
        idempotencyKey,
        startCodingAgent: request.startCodingAgent,
      });

      const threadId = ThreadId.make(crypto.randomUUID());
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`task-runtime:thread:create:${request.workSessionId}`),
        threadId,
        projectId,
        title: request.title,
        modelSelection,
        runtimeMode: request.runtimeMode,
        interactionMode: request.interactionMode,
        branch: providerResult.worktree?.branch ?? null,
        worktreePath: providerResult.worktree?.worktreePath ?? null,
        createdAt: now,
      });

      if (request.startCodingAgent) {
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`task-runtime:turn:start:${request.workSessionId}`),
          threadId,
          message: {
            messageId: MessageId.make(`task-runtime:${request.workSessionId}`),
            role: "user",
            text: request.initialPrompt,
            attachments: [],
          },
          modelSelection,
          runtimeMode: request.runtimeMode,
          interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        });
      }

      return materializationResponse({
        request,
        projectId,
        threadId,
        providerResult,
        acceptedAt: now,
      });
    });

  const materializeTaskRuntime: SandboxRuntimeShape["materializeTaskRuntime"] = (request) =>
    Effect.gen(function* () {
      const idempotencyKey = resolveIdempotencyKey(request);
      const deferred = yield* Deferred.make<TaskRuntimeMaterializeResponse, SandboxRuntimeError>();
      const decision = yield* SynchronizedRef.modify(
        materializations,
        (current): readonly [MaterializationDecision, Map<string, MaterializationEntry>] => {
          const existing = current.get(idempotencyKey);
          if (existing !== undefined) {
            return [{ tag: "reuse", entry: existing }, current] as const;
          }

          const next = new Map(current);
          next.set(idempotencyKey, { status: "in-flight", deferred });
          return [{ tag: "run" }, next] as const;
        },
      );

      if (decision.tag === "reuse") {
        return decision.entry.status === "completed"
          ? decision.entry.response
          : yield* Deferred.await(decision.entry.deferred);
      }

      const exit = yield* Effect.exit(
        materializeFresh(request, idempotencyKey).pipe(
          Effect.mapError((error) => sandboxRuntimeErrorFromUnknown(error, "materialize")),
        ),
      );
      yield* SynchronizedRef.update(materializations, (current) => {
        const next = new Map(current);
        if (Exit.isSuccess(exit)) {
          next.set(idempotencyKey, {
            status: "completed",
            response: exit.value,
          });
        } else {
          next.delete(idempotencyKey);
        }
        return next;
      });
      yield* settleDeferred(deferred, exit).pipe(Effect.orDie);
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      return yield* Effect.failCause(exit.cause);
    });

  return {
    materializeTaskRuntime,
    reconnectTaskRuntime(request) {
      return Effect.gen(function* () {
        const provider = yield* providerRegistry.get("local");
        const result = yield* provider.reconnect({
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          sandboxId: request.sandboxId,
        });
        return {
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          sandbox: result.sandbox,
          environment: result.environment,
          services: result.services,
          acceptedAt: new Date().toISOString(),
        };
      }).pipe(Effect.mapError((error) => sandboxRuntimeErrorFromUnknown(error, "reconnect")));
    },
    archiveTaskRuntime(request) {
      return Effect.gen(function* () {
        const provider = yield* providerRegistry.get("local");
        const result = yield* provider.archive({ sandboxId: request.sandboxId });
        return {
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          sandbox: result.sandbox,
          archivedAt: result.archivedAt,
        };
      }).pipe(Effect.mapError((error) => sandboxRuntimeErrorFromUnknown(error, "archive")));
    },
    getTaskRuntimeStatus(request) {
      return Effect.gen(function* () {
        const provider = yield* providerRegistry.get("local");
        const sandbox = yield* provider.getStatus({ sandboxId: request.sandboxId });
        return {
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          sandbox,
          services: sandbox.services,
          refreshedAt: new Date().toISOString(),
        };
      }).pipe(Effect.mapError((error) => sandboxRuntimeErrorFromUnknown(error, "status")));
    },
  } satisfies SandboxRuntimeShape;
});

export const SandboxRuntimeLive = Layer.effect(SandboxRuntime, makeSandboxRuntime);
