// EMPOWERRD: fork-owned side-table service for a thread's Jira association.
// Mirrors the upstream ProjectionThreadProposedPlans pattern. The Jira key is
// stored here (keyed by threadId), NOT on the core thread schema, and is
// written directly by the fork RPC handler rather than the event projector.
import { IsoDateTime, JiraKey, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadJira = Schema.Struct({
  threadId: ThreadId,
  jiraKey: JiraKey,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadJira = typeof ProjectionThreadJira.Type;

export const GetProjectionThreadJiraInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadJiraInput = typeof GetProjectionThreadJiraInput.Type;

export const DeleteProjectionThreadJiraInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadJiraInput = typeof DeleteProjectionThreadJiraInput.Type;

export interface ProjectionThreadJiraRepositoryShape {
  readonly upsert: (row: ProjectionThreadJira) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (
    input: GetProjectionThreadJiraInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadJira>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionThreadJira>,
    ProjectionRepositoryError
  >;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadJiraInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadJiraRepository extends Context.Service<
  ProjectionThreadJiraRepository,
  ProjectionThreadJiraRepositoryShape
>()("t3/persistence/Services/ProjectionThreadJira/ProjectionThreadJiraRepository") {}
