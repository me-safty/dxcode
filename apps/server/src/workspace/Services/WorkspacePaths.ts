/**
 * WorkspacePaths - Effect service contract for workspace path handling.
 *
 * Owns normalization and validation of workspace roots plus safe resolution of
 * workspace-root-relative paths.
 *
 * @module WorkspacePaths
 */
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class WorkspacePathsError extends Schema.TaggedErrorClass<WorkspacePathsError>()(
  "WorkspacePathsError",
  {
    workspaceRoot: Schema.optional(Schema.String),
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * WorkspacePathsShape - Service API for workspace path normalization and guards.
 */
export interface WorkspacePathsShape {
  /**
   * Normalize a user-provided workspace root and verify it exists as a directory.
   */
  readonly normalizeWorkspaceRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<string, WorkspacePathsError>;

  /**
   * Resolve a relative path within a validated workspace root.
   *
   * Rejects absolute paths and traversal attempts outside the workspace root.
   */
  readonly resolveRelativePathWithinRoot: (input: {
    workspaceRoot: string;
    relativePath: string;
  }) => Effect.Effect<{ absolutePath: string; relativePath: string }, WorkspacePathsError>;
}

/**
 * WorkspacePaths - Service tag for workspace path normalization and resolution.
 */
export class WorkspacePaths extends ServiceMap.Service<WorkspacePaths, WorkspacePathsShape>()(
  "t3/workspace/Services/WorkspacePaths",
) {}
