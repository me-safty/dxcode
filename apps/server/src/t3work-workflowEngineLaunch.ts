/**
 * Launches a recipe's `.workflow.ts` through the durable engine (Epic 25 §Host wiring) — the
 * repointed replacement for the deleted step-union launch path.
 *
 * It builds the per-run orchestration broker, registers a `resume` closure (so the reactor can
 * drive the run forward when a turn completes or the user replies), then calls
 * `startWorkflow`. A run that fires an ask verb returns a `SuspendedResult` and is parked; the
 * registry keeps its `resume` alive until the reply lands. A completed run is unregistered.
 *
 * The Promise/Effect bridge: orchestration commands run via the injected `dispatch`
 * (`Effect.runPromiseWith` of a captured runtime), so the Promise-based engine can drive the
 * Effect-based host. `resume` re-enters `resumeWorkflow`, which replays journaled asks (NOT
 * re-firing the broker) and only fires past the recorded frontier.
 */

import type {
  ModelSelection,
  OrchestrationCommand,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";

import {
  appendResolvedEntry,
  resumeWorkflow,
  startWorkflow,
  type SuspendedResult,
  type WorkflowRef,
  type WorkflowRunOptions,
  type WorkflowRunResult,
} from "@t3work/sdk";

import { createWorkflowEngineBroker } from "./t3work-workflowEngineBroker.ts";
import type { T3workWorkflowEngineRegistryShape } from "./t3work-workflowEngineRegistry.ts";

export type WorkflowLaunchStatus = "completed" | "suspended" | "failed";

export interface LaunchWorkflowRecipeInput {
  readonly runId: string;
  /** Absolute path to the recipe's `.workflow.ts` (resolved by discovery). */
  readonly workflowPath: string;
  readonly args: unknown;
  readonly runsRoot: string;
  /** The chat the user launched from; `undefined` for a headless run (`thread` is undefined). */
  readonly launchThreadId: string | undefined;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly registry: T3workWorkflowEngineRegistryShape;
  readonly dispatch: (command: OrchestrationCommand) => Promise<void>;
  readonly newId: () => string;
  readonly nowIso: () => string;
  /** Optional sink for the validated workflow output when the run completes. */
  readonly onComplete?: (output: unknown) => Promise<void>;
  /** Optional sink for an uncaught run failure. */
  readonly onError?: (error: unknown) => Promise<void>;
}

export interface LaunchWorkflowRecipeResult {
  readonly runId: string;
  readonly status: WorkflowLaunchStatus;
}

export async function launchWorkflowRecipe(
  input: LaunchWorkflowRecipeInput,
): Promise<LaunchWorkflowRecipeResult> {
  const ref: WorkflowRef = {
    kind: "workflow",
    path: input.workflowPath,
    absolutePath: input.workflowPath,
  };
  const broker = createWorkflowEngineBroker({
    runId: input.runId,
    projectId: input.projectId,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    registry: input.registry,
    dispatch: input.dispatch,
    newId: input.newId,
    nowIso: input.nowIso,
  });
  const options: WorkflowRunOptions = {
    runsRoot: input.runsRoot,
    broker,
    tools: [],
    scripts: {},
    ...(input.launchThreadId === undefined ? {} : { launchThreadId: input.launchThreadId }),
  };

  const settle = async (
    result: WorkflowRunResult<unknown> | SuspendedResult,
  ): Promise<WorkflowLaunchStatus> => {
    if ("suspended" in result) return "suspended"; // parked — the reactor resumes it later
    input.registry.deleteRun(input.runId);
    await input.onComplete?.(result.result);
    return "completed";
  };

  const resume = async (correlationId: string, reply: unknown): Promise<void> => {
    if (!appendResolvedEntry({ runsRoot: input.runsRoot, runId: input.runId, correlationId, reply })) {
      return; // already settled (a late reply after resolution or dismissal)
    }
    try {
      await settle(await resumeWorkflow(input.runId, ref, input.args, options));
    } catch (error) {
      input.registry.deleteRun(input.runId);
      await input.onError?.(error);
    }
  };

  input.registry.registerRun(input.runId, { resume });

  try {
    const status = await settle(await startWorkflow(ref, input.args, { ...options, runId: input.runId }));
    return { runId: input.runId, status };
  } catch (error) {
    input.registry.deleteRun(input.runId);
    await input.onError?.(error);
    return { runId: input.runId, status: "failed" };
  }
}
