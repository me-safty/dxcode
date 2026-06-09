import {
  ProjectId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { makeResolveLaunchEnv } from "../../launchEnv/Services/LaunchEnv.ts";
import {
  bindTerminalLaunchEnvResolver,
  type TerminalLaunchEnvProjectionShape,
  type TerminalLaunchEnvResolver,
} from "../resolveTerminalLaunchEnv.ts";

export type TerminalLaunchEnvResolverTestFixtures = {
  readonly t3Home: string;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
};

export const makeTerminalLaunchEnvProjection = (
  fixtures: Pick<TerminalLaunchEnvResolverTestFixtures, "projects" | "threads">,
): TerminalLaunchEnvProjectionShape => {
  const projectsById = new Map(
    (fixtures.projects ?? []).map((project) => [project.id, project] as const),
  );
  const threadsById = new Map(
    (fixtures.threads ?? []).map((thread) => [thread.id, thread] as const),
  );

  return {
    getProjectShellById: (projectId) =>
      Effect.succeed(Option.fromNullishOr(projectsById.get(projectId))),
    getThreadShellById: (threadId) =>
      Effect.succeed(Option.fromNullishOr(threadsById.get(threadId))),
  };
};

export const bindTerminalLaunchEnvResolverForTest = (
  fixtures: TerminalLaunchEnvResolverTestFixtures,
): TerminalLaunchEnvResolver =>
  bindTerminalLaunchEnvResolver(
    { resolve: makeResolveLaunchEnv(fixtures.t3Home) },
    makeTerminalLaunchEnvProjection(fixtures),
  );

/** Passthrough resolver for Manager tests that supply env on the input directly. */
export const terminalLaunchEnvResolverTestStub = (
  projectId: ProjectId,
): TerminalLaunchEnvResolver => ({
  resolveOpenInput: (input) => Effect.succeed(input),
  resolveRestartInput: (input) => Effect.succeed(input),
  resolveAttachInput: (input) =>
    Effect.succeed({
      ...input,
      projectId,
    }),
});
