import {
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  LaunchEnv,
  makeResolveForThread,
  makeResolveLaunchEnv,
  type LaunchEnvShape,
  type ResolvedLaunchEnvForThread,
} from "../Services/LaunchEnv.ts";

export type LaunchEnvTestFixtures = {
  readonly t3Home: string;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
};

const toProjectMap = (projects: ReadonlyArray<OrchestrationProjectShell> | undefined) =>
  new Map((projects ?? []).map((project) => [project.id, project] as const));

const toThreadMap = (threads: ReadonlyArray<OrchestrationThreadShell> | undefined) =>
  new Map((threads ?? []).map((thread) => [thread.id, thread] as const));

export const makeLaunchEnvTestShape = (fixtures: LaunchEnvTestFixtures): LaunchEnvShape => {
  const resolve = makeResolveLaunchEnv(fixtures.t3Home);
  const projectsById = toProjectMap(fixtures.projects);
  const threadsById = toThreadMap(fixtures.threads);

  return {
    resolve,
    resolveForThread: makeResolveForThread(resolve, {
      getThreadShellById: (threadId) =>
        Effect.succeed(Option.fromNullishOr(threadsById.get(threadId))),
      getProjectShellById: (projectId) =>
        Effect.succeed(Option.fromNullishOr(projectsById.get(projectId))),
    }),
  };
};

export const launchEnvTestStub = (input: {
  readonly t3Home: string;
  readonly projectId: ProjectId;
}): LaunchEnvShape => ({
  resolve: makeResolveLaunchEnv(input.t3Home),
  resolveForThread: (resolveInput) =>
    Effect.succeed({
      projectId: input.projectId,
      ...(resolveInput.worktreePath !== undefined
        ? { worktreePath: resolveInput.worktreePath }
        : {}),
      env: (resolveInput.extraEnv ?? {}) as Record<string, string>,
    } satisfies ResolvedLaunchEnvForThread),
});

export const LaunchEnvTestLayer = {
  stub: (input: { readonly t3Home: string; readonly projectId: ProjectId }) =>
    Layer.succeed(LaunchEnv, launchEnvTestStub(input)),

  withFixtures: (fixtures: LaunchEnvTestFixtures) =>
    Layer.succeed(LaunchEnv, makeLaunchEnvTestShape(fixtures)),
};

/** Default CLI/unit-test layer: resolve-only stub with a fixed project id. */
export const defaultLaunchEnvTestLayer = LaunchEnvTestLayer.stub({
  t3Home: "/tmp/t3-launch-env-test",
  projectId: ProjectId.make("project-1"),
});
