/**
 * WorkflowRunRepository - persistence for durable workflow-engine run records.
 *
 * Owns the `workflow_runs` table: the run record + its pending ask. This is the DATA a boot
 * rehydration needs to rebuild a suspended run's resume closure (the CODE — broker / tools /
 * llm / callbacks — is reconstructed from host layers, never persisted). `status` drives the
 * boot scan (`listByStatus("suspended")`); the `pending*` columns let the reactor resolve the
 * right run when a turn completes / the user replies (Epic 25 §Open question 2).
 *
 * @module WorkflowRunRepository
 */
import {
  IsoDateTime,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

/** Run lifecycle, mirrored from the SDK's start/suspend/complete path. */
export const WorkflowRunStatus = Schema.Literals(["running", "suspended", "completed", "failed"]);
export type WorkflowRunStatus = typeof WorkflowRunStatus.Type;

/** Which ask kind a suspended run is parked on (matches the engine registry's pending kind). */
export const WorkflowRunPendingKind = Schema.Literals(["thread.turn", "user.input"]);
export type WorkflowRunPendingKind = typeof WorkflowRunPendingKind.Type;

export const WorkflowRun = Schema.Struct({
  runId: Schema.String,
  /** Absolute path to the recipe's `.workflow.ts` — re-resolved to a WorkflowRef on boot. */
  workflowPath: Schema.String,
  /** The launch args (replayed verbatim into resumeWorkflow); stored as JSON. */
  args: Schema.Unknown,
  /** SHA-256 of canonical-JSON args — mirrors the journal's runMeta drift boundary. */
  argsHash: Schema.String,
  /** The chat the run launched from; `null` for a headless run (`thread` unbound). */
  launchThreadId: Schema.NullOr(Schema.String),
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  status: WorkflowRunStatus,
  /** The thread the current ask is parked on (a spawned thread for agent() sub-threads). */
  pendingThreadId: Schema.NullOr(Schema.String),
  pendingCorrelationId: Schema.NullOr(Schema.String),
  pendingKind: Schema.NullOr(WorkflowRunPendingKind),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowRun = typeof WorkflowRun.Type;

export const GetWorkflowRunInput = Schema.Struct({ runId: Schema.String });
export type GetWorkflowRunInput = typeof GetWorkflowRunInput.Type;

export const ListWorkflowRunsByStatusInput = Schema.Struct({ status: WorkflowRunStatus });
export type ListWorkflowRunsByStatusInput = typeof ListWorkflowRunsByStatusInput.Type;

export const SetWorkflowRunStatusInput = Schema.Struct({
  runId: Schema.String,
  status: WorkflowRunStatus,
  updatedAt: IsoDateTime,
});
export type SetWorkflowRunStatusInput = typeof SetWorkflowRunStatusInput.Type;

/** Flip a run to `suspended` and record the ask it is parked on, in one update. */
export const SetWorkflowRunPendingInput = Schema.Struct({
  runId: Schema.String,
  pendingThreadId: Schema.String,
  pendingCorrelationId: Schema.String,
  pendingKind: WorkflowRunPendingKind,
  updatedAt: IsoDateTime,
});
export type SetWorkflowRunPendingInput = typeof SetWorkflowRunPendingInput.Type;

/** Clear the pending ask and set a (typically terminal) status, in one update. */
export const ClearWorkflowRunPendingInput = Schema.Struct({
  runId: Schema.String,
  status: WorkflowRunStatus,
  updatedAt: IsoDateTime,
});
export type ClearWorkflowRunPendingInput = typeof ClearWorkflowRunPendingInput.Type;

/** WorkflowRunRepositoryShape - service API for durable run records. */
export interface WorkflowRunRepositoryShape {
  /** Insert or replace a run row (keyed by `runId`). */
  readonly upsert: (row: WorkflowRun) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Read a run row by id. */
  readonly getById: (
    input: GetWorkflowRunInput,
  ) => Effect.Effect<Option.Option<WorkflowRun>, ProjectionRepositoryError>;
  /** All run rows in a given status (boot rehydration reads `"suspended"`). */
  readonly listByStatus: (
    input: ListWorkflowRunsByStatusInput,
  ) => Effect.Effect<ReadonlyArray<WorkflowRun>, ProjectionRepositoryError>;
  /** Set a run's status (without touching the pending ask). */
  readonly setStatus: (
    input: SetWorkflowRunStatusInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Flip to `suspended` and record the pending ask (fired when an ask verb suspends). */
  readonly setPending: (
    input: SetWorkflowRunPendingInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Clear the pending ask and set the given status (on resume completion/failure). */
  readonly clearPending: (
    input: ClearWorkflowRunPendingInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/** WorkflowRunRepository - service tag for durable run-record persistence. */
export class WorkflowRunRepository extends Context.Service<
  WorkflowRunRepository,
  WorkflowRunRepositoryShape
>()("t3/persistence/Services/WorkflowRuns/WorkflowRunRepository") {}
