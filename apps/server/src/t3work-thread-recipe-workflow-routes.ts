import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { PROJECT_RECIPE_ACTIVITY_KIND_LAUNCH } from "@t3tools/project-recipes";
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
import { WorkflowJournalStore } from "./persistence/Services/WorkflowJournalStore.ts";
import { WorkflowRunRepository } from "./persistence/Services/WorkflowRuns.ts";
import { toT3workError } from "./t3work-project-repository-utils.ts";
import { t3workRandomUUID } from "./t3work-random.ts";
import {
  buildRunningWorkflowRunRow,
  makeWorkflowRunLifecycle,
} from "./t3work-workflowEngineDurability.ts";
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
    const runRepository = yield* WorkflowRunRepository;
    const journalStore = yield* WorkflowJournalStore;
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

    const runId = t3workRandomUUID();
    const args = input.launch.parameters ?? {};
    // Persist the run record + journal in SQLite so a suspend survives a restart (Epic 25
    // §Open question 2). The lifecycle write-through keeps `workflow_runs` the source of
    // truth that boot rehydration reads; the in-memory registry stays the reactor's hot index.
    const lifecycle = makeWorkflowRunLifecycle({
      repo: runRepository,
      row: buildRunningWorkflowRunRow({
        runId,
        workflowPath,
        args,
        launchThreadId: threadIdInput,
        projectId: thread.projectId,
        modelSelection,
        runtimeMode,
        interactionMode,
        nowIso: nowIso(),
      }),
      nowIso,
    });

    // Stamp the launch thread with a recipe-launch activity BEFORE starting the run. The web
    // composer arms a one-shot "launch this recipe" override while a thread has a recipe
    // kickoffWorkflow and no launch activity yet; without this stamp the override never disarms,
    // so the very first reply a user types to answer the workflow's `askUser` re-launches the
    // recipe instead of resolving the pending ask (and the initial launch can double-fire).
    yield* Effect.promise(() =>
      dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`t3work-recipe-launch:${runId}`),
        threadId,
        activity: {
          id: EventId.make(`t3work-recipe-launch:${runId}`),
          tone: "info",
          kind: PROJECT_RECIPE_ACTIVITY_KIND_LAUNCH,
          summary: "Recipe started",
          payload: { workflowRunId: runId },
          turnId: null,
          createdAt: nowIso(),
        },
        createdAt: nowIso(),
      }),
    );

    const result = yield* Effect.promise(() =>
      launchWorkflowRecipe({
        runId,
        workflowPath,
        args,
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
        store: journalStore,
        lifecycle,
      }),
    );

    return okJson({ ok: true, mode: "engine", runId: result.runId, status: result.status });
  }).pipe(
    Effect.mapError((cause) => toT3workError(cause, "Failed to launch recipe workflow.")),
    Effect.catch(errorResponse),
  ),
);

/**
 * Answer a workflow's pending `askUser`. Rather than resolving the parked run directly (which
 * would make the user's reply invisible and risk a second resolution racing the reactor), this
 * appends the reply as a normal user message on the thread. The workflow-engine reactor then
 * resolves the parked `user.input` from that `thread.message-sent` event — a single resolution
 * path, the reply renders like any other message, and no agent turn is started.
 */
export const t3workThreadWorkflowResolveInputRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/thread/workflow/resolve-input",
  Effect.gen(function* () {
    const orchestration = yield* OrchestrationEngineService;
    const input = yield* readJsonBody<{ threadId?: string; text?: string; messageId?: string }>();
    const threadIdInput = input.threadId?.trim() ?? "";
    const text = typeof input.text === "string" ? input.text : "";
    // Reuse the client's optimistic message id so the upserted message reconciles with the
    // optimistic bubble the composer already rendered (otherwise the reply shows twice).
    const messageIdInput = input.messageId?.trim();
    if (threadIdInput.length === 0) {
      return yield* new T3workAtlassianError({ message: "threadId is required." });
    }
    if (text.length === 0) {
      return yield* new T3workAtlassianError({ message: "text is required." });
    }

    yield* orchestration.dispatch({
      type: "thread.message.upsert",
      commandId: CommandId.make(`t3work-wf-resolve:${t3workRandomUUID()}`),
      threadId: ThreadId.make(threadIdInput),
      message: {
        messageId: MessageId.make(
          messageIdInput && messageIdInput.length > 0 ? messageIdInput : t3workRandomUUID(),
        ),
        role: "user",
        text,
        turnId: null,
        streaming: false,
      },
      createdAt: nowIso(),
    });

    return okJson({ ok: true });
  }).pipe(
    Effect.mapError((cause) => toT3workError(cause, "Failed to resolve workflow input.")),
    Effect.catch(errorResponse),
  ),
);
