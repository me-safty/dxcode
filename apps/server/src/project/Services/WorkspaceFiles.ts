import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectWriteFileInput, ProjectWriteFileResult } from "@t3tools/contracts";

export class WorkspaceFilesError extends Schema.TaggedErrorClass<WorkspaceFilesError>()(
  "WorkspaceFilesError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceFilesShape {
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<ProjectWriteFileResult, WorkspaceFilesError>;
}

export class WorkspaceFiles extends ServiceMap.Service<WorkspaceFiles, WorkspaceFilesShape>()(
  "t3/project/Services/WorkspaceFiles",
) {}
