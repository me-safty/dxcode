import {
  IsoDateTime,
  SubagentReport,
  SubagentRunId,
  SubagentRunStatus,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSubagentRun = Schema.Struct({
  runId: SubagentRunId,
  parentThreadId: ThreadId,
  subagentThreadId: Schema.NullOr(ThreadId),
  skillId: TrimmedNonEmptyString,
  skillTitle: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
  status: SubagentRunStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  report: Schema.NullOr(SubagentReport),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  acceptedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionThreadSubagentRun = typeof ProjectionThreadSubagentRun.Type;

export const ListProjectionThreadSubagentRunsInput = Schema.Struct({
  parentThreadId: ThreadId,
});
export type ListProjectionThreadSubagentRunsInput =
  typeof ListProjectionThreadSubagentRunsInput.Type;

export interface ProjectionThreadSubagentRunRepositoryShape {
  readonly upsert: (
    run: ProjectionThreadSubagentRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByParentThreadId: (
    input: ListProjectionThreadSubagentRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadSubagentRun>, ProjectionRepositoryError>;
}

export class ProjectionThreadSubagentRunRepository extends ServiceMap.Service<
  ProjectionThreadSubagentRunRepository,
  ProjectionThreadSubagentRunRepositoryShape
>()("t3/persistence/Services/ProjectionThreadSubagentRuns/ProjectionThreadSubagentRunRepository") {}
