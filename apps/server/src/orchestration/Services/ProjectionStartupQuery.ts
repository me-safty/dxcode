/**
 * ProjectionStartupQuery - Lightweight projection queries used during startup.
 *
 * Avoids building the full orchestration snapshot for small startup lookups
 * like heartbeat counts and auto-bootstrap existence checks.
 *
 * @module ProjectionStartupQuery
 */
import { ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const ProjectionStartupCounts = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
export type ProjectionStartupCounts = typeof ProjectionStartupCounts.Type;

export const GetProjectionAutoBootstrapStateInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
export type GetProjectionAutoBootstrapStateInput = typeof GetProjectionAutoBootstrapStateInput.Type;

export const ProjectionAutoBootstrapProject = Schema.Struct({
  id: ProjectId,
  defaultModelSelection: Schema.NullOr(ModelSelection),
});
export type ProjectionAutoBootstrapProject = typeof ProjectionAutoBootstrapProject.Type;

export const ProjectionAutoBootstrapState = Schema.Struct({
  project: Schema.NullOr(ProjectionAutoBootstrapProject),
  threadId: Schema.NullOr(ThreadId),
});
export type ProjectionAutoBootstrapState = typeof ProjectionAutoBootstrapState.Type;

export interface ProjectionStartupQueryShape {
  readonly getStartupCounts: () => Effect.Effect<
    ProjectionStartupCounts,
    ProjectionRepositoryError
  >;

  readonly getAutoBootstrapState: (
    input: GetProjectionAutoBootstrapStateInput,
  ) => Effect.Effect<ProjectionAutoBootstrapState, ProjectionRepositoryError>;
}

export class ProjectionStartupQuery extends ServiceMap.Service<
  ProjectionStartupQuery,
  ProjectionStartupQueryShape
>()("t3/orchestration/Services/ProjectionStartupQuery") {}
