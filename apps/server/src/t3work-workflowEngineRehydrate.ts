/**
 * Boot rehydration for durable workflow runs (Epic 25 §Open question 2).
 *
 * On startup — after the orchestration reactors are live, before the welcome event — every
 * `workflow_runs` row in status `suspended` is rebuilt into a live, resumable run:
 *   • DATA from the DB — workflow path, launch args, project/model/mode, and the pending ask —
 *     is read off the row.
 *   • CODE from the host layers — the orchestration `dispatch`, the SQLite journal store, the
 *     in-memory registry, the lifecycle write-through — is reconstructed here and handed to
 *     {@link createWorkflowRunController}, the SAME builder the live launch uses.
 * The controller re-registers the run's `resume` closure; restoring the pending ask into the
 * in-memory registry then makes the reactor behave identically whether the ask was set this
 * uptime or recovered from a prior one. No local-disk journal is involved — replay reads the
 * DB-backed journal through the injected store.
 *
 * Single-instance only (Epic 25 §Out of scope): no lease/lock, so this assumes one server owns
 * these rows. A row whose pending ask is missing is logged and skipped (it cannot be resolved).
 */

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { ServerConfig } from "./config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { WorkflowJournalStore } from "./persistence/Services/WorkflowJournalStore.ts";
import { WorkflowRunRepository } from "./persistence/Services/WorkflowRuns.ts";
import { t3workRandomUUID } from "./t3work-random.ts";
import { makeWorkflowRunLifecycle } from "./t3work-workflowEngineDurability.ts";
import { createWorkflowRunController } from "./t3work-workflowEngineLaunch.ts";
import { T3workWorkflowEngineRegistry } from "./t3work-workflowEngineRegistry.ts";

function nowIso(): string {
  return DateTime.formatIso(DateTime.nowUnsafe());
}

export const rehydrateSuspendedWorkflowRuns = Effect.fn("rehydrateSuspendedWorkflowRuns")(
  function* () {
    const repo = yield* WorkflowRunRepository;
    const store = yield* WorkflowJournalStore;
    const registry = yield* T3workWorkflowEngineRegistry;
    const orchestration = yield* OrchestrationEngineService;
    const serverConfig = yield* ServerConfig;

    const suspended = yield* repo.listByStatus({ status: "suspended" });
    if (suspended.length === 0) return;

    // The journal lives in the DB (store), so `runsRoot` only backs the workspace-root default
    // for tool scratch files; the server cwd matches the bootstrapped project's workspace.
    const runsRoot = `${serverConfig.cwd}/.t3work-runs`;
    const dispatch = (command: Parameters<typeof orchestration.dispatch>[0]): Promise<void> =>
      Effect.runPromise(orchestration.dispatch(command)).then(() => undefined);

    let restored = 0;
    for (const run of suspended) {
      if (
        run.pendingThreadId === null ||
        run.pendingCorrelationId === null ||
        run.pendingKind === null
      ) {
        yield* Effect.logWarning("skipping suspended workflow run with no recorded pending ask", {
          runId: run.runId,
        });
        continue;
      }

      // Rebuild the resume closure (CODE from layers) over the persisted DATA, then restore
      // the pending ask so the reactor resolves it exactly as if set this uptime.
      const lifecycle = makeWorkflowRunLifecycle({ repo, row: run, nowIso });
      createWorkflowRunController({
        runId: run.runId,
        workflowPath: run.workflowPath,
        args: run.args,
        runsRoot,
        launchThreadId: run.launchThreadId ?? undefined,
        projectId: run.projectId,
        modelSelection: run.modelSelection,
        runtimeMode: run.runtimeMode,
        interactionMode: run.interactionMode,
        registry,
        dispatch,
        newId: () => t3workRandomUUID(),
        nowIso,
        store,
        lifecycle,
      });
      registry.setPending(run.pendingThreadId, {
        runId: run.runId,
        correlationId: run.pendingCorrelationId,
        kind: run.pendingKind,
      });
      restored += 1;
    }

    yield* Effect.logInfo("rehydrated suspended workflow runs", { restored });
  },
);
