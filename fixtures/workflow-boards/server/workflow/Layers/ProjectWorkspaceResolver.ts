import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkflowEnvironmentsReadCapability } from "../Services/WorkflowCapabilities.ts";
import {
  ProjectWorkspaceResolver,
  ProjectWorkspaceResolverError,
  type ProjectWorkspaceResolverShape,
} from "../Services/ProjectWorkspaceResolver.ts";

const toResolverError = (message: string) => (cause: unknown) =>
  new ProjectWorkspaceResolverError({ message, cause });

const make = Effect.gen(function* () {
  const environments = yield* WorkflowEnvironmentsReadCapability;

  const resolve: ProjectWorkspaceResolverShape["resolve"] = (projectId) =>
    environments.getProjectById(projectId).pipe(
      Effect.mapError(toResolverError(`Failed to resolve workspace for project ${projectId}`)),
      Effect.flatMap((project) =>
        project === null
          ? Effect.fail(
              new ProjectWorkspaceResolverError({
                message: `Project ${projectId} was not found`,
              }),
            )
          : Effect.succeed(project.workspaceRoot as string),
      ),
    );

  return { resolve } satisfies ProjectWorkspaceResolverShape;
});

export const ProjectWorkspaceResolverLive = Layer.effect(ProjectWorkspaceResolver, make);
