import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { LaunchProjectRecipeWorkflowRequest } from "@t3tools/project-recipes";
import { createModelSelection } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { HttpRouter } from "effect/unstable/http";

import {
  errorResponse,
  okJson,
  readJsonBody,
  T3workAtlassianError,
} from "./t3work-atlassian-http.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { toT3workError } from "./t3work-project-repository-utils.ts";
import { t3workRandomUUID } from "./t3work-random.ts";
import {
  isProviderInteractionMode,
  isRuntimeMode,
  loadThreadProjectContext,
} from "./t3work-thread-recipe-workflow-routes-shared.ts";
import { launchWorkflowRecipe } from "./t3work-workflowEngineLaunch.ts";
import { T3workWorkflowEngineRegistry } from "./t3work-workflowEngineRegistry.ts";

function nowIso(): string {
  return DateTime.formatIso(DateTime.nowUnsafe());
}

/**
 * Launch a recipe's `.workflow.ts` through the durable engine (Epic 25). Replaces the legacy
 * step-union launch: it resolves the launching thread's project, builds a per-run
 * orchestration broker, and calls `startWorkflow`. A run that fires an ask verb suspends and is
 * parked by the registry; the workflow-engine reactor resumes it when the reply lands.
 */
export const t3workThreadRecipeWorkflowLaunchRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/thread/recipe-workflow/launch",
  Effect.gen(function* () {
    const orchestration = yield* OrchestrationEngineService;
    const registry = yield* T3workWorkflowEngineRegistry;
    const input = yield* readJsonBody<LaunchProjectRecipeWorkflowRequest>();

    const threadIdInput = input.threadId?.trim() ?? "";
    const modelInstanceId = input.modelSelection?.instanceId?.trim() ?? "";
    const modelName = input.modelSelection?.model?.trim() ?? "";
    if (!input.launch || typeof input.launch !== "object") {
      return yield* new T3workAtlassianError({ message: "launch is required." });
    }
    const workflowPath = input.launch.workflowPath?.trim() ?? "";
    if (workflowPath.length === 0) {
      return yield* new T3workAtlassianError({
        message: "launch.workflowPath is required: this recipe has no .workflow.ts to run.",
      });
    }
    if (threadIdInput.length === 0) {
      return yield* new T3workAtlassianError({
        message: "threadId is required: headless recipe launches are not yet supported by the engine.",
      });
    }
    if (modelInstanceId.length === 0 || modelName.length === 0) {
      return yield* new T3workAtlassianError({ message: "modelSelection is required." });
    }

    const threadId = ThreadId.make(threadIdInput);
    const runtimeMode =
      input.runtimeMode && isRuntimeMode(input.runtimeMode) ? input.runtimeMode : DEFAULT_RUNTIME_MODE;
    const interactionMode =
      input.interactionMode && isProviderInteractionMode(input.interactionMode)
        ? input.interactionMode
        : DEFAULT_PROVIDER_INTERACTION_MODE;
    const modelSelection = createModelSelection(ProviderInstanceId.make(modelInstanceId), modelName);
    const { project, thread } = yield* loadThreadProjectContext(threadId);

    const dispatch = (command: Parameters<typeof orchestration.dispatch>[0]): Promise<void> =>
      Effect.runPromise(orchestration.dispatch(command)).then(() => undefined);

    const result = yield* Effect.promise(() =>
      launchWorkflowRecipe({
        runId: t3workRandomUUID(),
        workflowPath,
        args: input.launch.parameters ?? {},
        runsRoot: `${project.workspaceRoot}/.t3work-runs`,
        launchThreadId: threadIdInput,
        projectId: thread.projectId,
        modelSelection,
        runtimeMode,
        interactionMode,
        registry,
        dispatch,
        newId: () => t3workRandomUUID(),
        nowIso,
      }),
    );

    return okJson({ ok: true, mode: "engine", runId: result.runId, status: result.status });
  }).pipe(
    Effect.mapError((cause) => toT3workError(cause, "Failed to launch recipe workflow.")),
    Effect.catch(errorResponse),
  ),
);
