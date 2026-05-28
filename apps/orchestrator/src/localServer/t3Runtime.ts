import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { ThreadId, type TaskRuntimeMaterializeResponse } from "@t3tools/contracts";

import { createT3ExecutionBridgeClient } from "../t3/client.ts";
import type { RuntimeMaterializeInput } from "./store.ts";
import { LocalOrchestratorStore } from "./store.ts";

const decodeThreadId = Schema.decodeUnknownSync(ThreadId);

function errorSummary(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class LocalTaskRuntime {
  readonly #store: LocalOrchestratorStore;

  constructor(store: LocalOrchestratorStore) {
    this.#store = store;
  }

  async materializeTaskRuntime(input: RuntimeMaterializeInput) {
    const tree = this.#store.getTaskRuntimeSeed(input.taskId);
    if (tree === null) {
      throw new Error(`Task ${input.taskId} does not exist`);
    }

    const workSessionSeed = this.#store.prepareWorkSessionSeed({
      taskId: input.taskId,
      startCodingAgent: input.startCodingAgent,
    });
    const client = createT3ExecutionBridgeClient();
    const idempotencyKey = `task-runtime:${input.taskId}:${workSessionSeed.workSessionId}`;

    let response: TaskRuntimeMaterializeResponse;
    try {
      response = await client.materializeTaskRuntime({
        taskId: input.taskId,
        workSessionId: workSessionSeed.workSessionId,
        initialPrompt: input.initialPrompt,
        ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
        title: tree.task.title,
        runtimeMode: "full-access",
        interactionMode: "default",
        startCodingAgent: input.startCodingAgent,
        ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
        idempotencyKey,
        project: {
          repoName: tree.project.repoName,
          workspaceRoot: tree.project.workspaceRoot,
          defaultBranch: tree.project.defaultBranch,
        },
      });
    } catch (error) {
      const failureSummary = errorSummary(error);
      this.#store.recordTaskRuntimeMaterializationFailed({
        taskId: input.taskId,
        workSessionId: workSessionSeed.workSessionId,
        eventKey: `${idempotencyKey}:failed`,
        failureSummary,
        failedAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
      });
      throw error;
    }

    this.#store.recordTaskRuntimeMaterialized({
      taskId: input.taskId,
      taskThreadId: workSessionSeed.taskThreadId,
      workSessionId: workSessionSeed.workSessionId,
      t3ProjectId: String(response.t3ProjectId),
      t3ThreadId: String(response.t3ThreadId),
      eventKey: `${idempotencyKey}:materialized`,
      acceptedAt: Date.parse(response.acceptedAt),
      ...(response.branch !== null ? { branch: response.branch } : {}),
      ...(response.worktreePath !== null ? { worktreePath: response.worktreePath } : {}),
      ...(response.environment !== undefined
        ? { environmentId: String(response.environment.environmentId) }
        : {}),
      ...(process.env.T3_EXECUTION_BRIDGE_BASE_URL !== undefined
        ? { runtimeEndpointUrl: process.env.T3_EXECUTION_BRIDGE_BASE_URL }
        : {}),
    });

    return {
      taskId: response.taskId,
      workSessionId: response.workSessionId,
      t3ProjectId: String(response.t3ProjectId),
      t3ThreadId: String(response.t3ThreadId),
      ...(response.environment !== undefined
        ? { environmentId: String(response.environment.environmentId) }
        : {}),
      branch: response.branch ?? null,
      worktreePath: response.worktreePath ?? null,
      acceptedAt: response.acceptedAt,
    };
  }

  async continueTaskRuntime(input: {
    readonly eventId: string;
    readonly taskId: string;
    readonly workSessionId: string;
    readonly t3ThreadId: string;
    readonly prompt: string;
    readonly attachments?: ReadonlyArray<{
      readonly type: "image";
      readonly name: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly dataUrl: string;
    }>;
  }) {
    this.#store.getTaskRuntimeContinuationRoute({
      taskId: input.taskId,
      workSessionId: input.workSessionId,
      t3ThreadId: input.t3ThreadId,
    });

    const claimedAt = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claim = this.#store.claimTaskRuntimeContinuation({
      taskId: input.taskId,
      workSessionId: input.workSessionId,
      t3ThreadId: input.t3ThreadId,
      eventKey: `${input.eventId}:runtime-continuation:claim`,
      claimedAt,
    });
    if (!claim.claimed) {
      return {
        taskId: input.taskId,
        workSessionId: input.workSessionId,
        t3ThreadId: input.t3ThreadId,
        acceptedAt: new Date(claim.claimedAt).toISOString(),
      };
    }

    const client = createT3ExecutionBridgeClient();
    const response = await client.continueExecutionRun({
      controlThreadId: input.taskId,
      executionRunId: input.workSessionId,
      t3ThreadId: decodeThreadId(input.t3ThreadId),
      prompt: input.prompt,
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      taskRuntime: true,
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    this.#store.recordTaskRuntimeContinuationAccepted({
      taskId: input.taskId,
      workSessionId: input.workSessionId,
      t3ThreadId: String(response.t3ThreadId),
      eventKey: `${input.eventId}:runtime-continuation`,
      acceptedAt: Date.parse(response.acceptedAt),
    });

    return {
      taskId: input.taskId,
      workSessionId: String(response.executionRunId),
      t3ThreadId: String(response.t3ThreadId),
      acceptedAt: response.acceptedAt,
    };
  }
}
