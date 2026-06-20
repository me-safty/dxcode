import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ProjectLaunchEnv,
  type ProjectLaunchEnvShape,
  type ResolvedProjectLaunchEnvForThread,
} from "../Services/ProjectLaunchEnv.ts";
import { mergeResolvedProjectLaunchEnv } from "../projectLaunchEnvUtils.ts";

export const projectLaunchEnvTestStub = (fixtures: {
  readonly t3Home: string;
  readonly projectId: ProjectId;
}): ProjectLaunchEnvShape => {
  const resolve: ProjectLaunchEnvShape["resolve"] = (input) =>
    Effect.succeed(
      mergeResolvedProjectLaunchEnv({
        t3Home: fixtures.t3Home,
        ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
        context: {
          projectRoot: input.projectRoot,
          projectId: String(input.projectId),
          threadId: input.threadId,
          ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
        },
      }),
    );

  return {
    resolve,
    resolveForThread: (resolveInput) =>
      Effect.succeed({
        projectId: fixtures.projectId,
        ...(resolveInput.worktreePath !== undefined
          ? { worktreePath: resolveInput.worktreePath }
          : {}),
        env: Object.fromEntries(
          Object.entries(resolveInput.extraEnv ?? {}).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      } satisfies ResolvedProjectLaunchEnvForThread),
  };
};

export const ProjectLaunchEnvTestLayer = {
  stub: (input: { readonly t3Home: string; readonly projectId: ProjectId }) =>
    Layer.succeed(ProjectLaunchEnv, projectLaunchEnvTestStub(input)),
};
