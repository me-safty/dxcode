import {
  ProjectId,
  TerminalCwdError,
  TerminalSessionLookupError,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../../config.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { EnvRecord } from "../launchEnvUtils.ts";
import { mergeResolvedLaunchEnv } from "../launchEnvUtils.ts";

export interface ResolveLaunchEnvInput {
  readonly projectRoot: string;
  readonly projectId: ProjectId | string;
  readonly threadId: string;
  readonly worktreePath?: string | null;
  readonly extraEnv?: EnvRecord;
}

export interface ResolveLaunchEnvForThreadInput {
  readonly threadId: string;
  readonly terminalId?: string | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly worktreePath?: string | null | undefined;
  readonly extraEnv?: EnvRecord;
}

export type ResolvedLaunchEnvForThread = {
  readonly projectId: ProjectId;
  readonly worktreePath?: string | null;
  readonly env: Record<string, string>;
};

export interface LaunchEnvShape {
  readonly resolve: (input: ResolveLaunchEnvInput) => Effect.Effect<Record<string, string>>;
  readonly resolveForThread: (
    input: ResolveLaunchEnvForThreadInput,
  ) => Effect.Effect<ResolvedLaunchEnvForThread, TerminalCwdError | TerminalSessionLookupError>;
}

export interface LaunchEnvProjectionShape {
  readonly getThreadShellById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, ProjectionRepositoryError>;
  readonly getProjectShellById: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectionRepositoryError>;
}

export const makeResolveLaunchEnv = (t3Home: string): LaunchEnvShape["resolve"] =>
  Effect.fn("LaunchEnv.resolve")(function* (input) {
    return mergeResolvedLaunchEnv({
      t3Home,
      ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
      context: {
        projectRoot: input.projectRoot,
        projectId: String(input.projectId),
        threadId: input.threadId,
        ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
      },
    });
  });

export const makeResolveForThread = (
  resolve: LaunchEnvShape["resolve"],
  projection: LaunchEnvProjectionShape,
): LaunchEnvShape["resolveForThread"] =>
  Effect.fn("LaunchEnv.resolveForThread")(function* (input) {
    const sessionLookupError = () =>
      new TerminalSessionLookupError({
        threadId: input.threadId,
        terminalId: input.terminalId ?? "",
      });

    const threadOption = yield* projection
      .getThreadShellById(ThreadId.make(input.threadId))
      .pipe(Effect.mapError(() => sessionLookupError()));

    const { projectId, worktreePath } = yield* Option.match(threadOption, {
      onSome: (thread) =>
        Effect.succeed({
          projectId: thread.projectId,
          worktreePath: input.worktreePath !== undefined ? input.worktreePath : thread.worktreePath,
        }),
      onNone: () => {
        if (input.projectId === undefined) {
          return Effect.fail(sessionLookupError());
        }

        return Effect.succeed({
          projectId: input.projectId,
          ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
        });
      },
    });

    const projectOption = yield* projection.getProjectShellById(projectId).pipe(
      Effect.mapError(
        (cause) =>
          new TerminalCwdError({
            cwd: projectId,
            reason: "statFailed",
            cause,
          }),
      ),
    );

    const project = yield* Option.match(projectOption, {
      onNone: () =>
        Effect.fail(
          new TerminalCwdError({
            cwd: projectId,
            reason: "notFound",
          }),
        ),
      onSome: Effect.succeed,
    });

    const env: Record<string, string> = yield* resolve({
      ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
      projectRoot: project.workspaceRoot,
      projectId: project.id,
      threadId: input.threadId,
      ...(worktreePath !== undefined ? { worktreePath } : {}),
    });

    return {
      projectId,
      ...(worktreePath !== undefined ? { worktreePath } : {}),
      env,
    } satisfies ResolvedLaunchEnvForThread;
  });

export class LaunchEnv extends Context.Service<LaunchEnv, LaunchEnvShape>()(
  "t3/launchEnv/Services/LaunchEnv",
) {}

export const makeLaunchEnv = Effect.fn("makeLaunchEnv")(function* () {
  const serverConfig = yield* ServerConfig;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const resolve = makeResolveLaunchEnv(serverConfig.baseDir);

  return {
    resolve,
    resolveForThread: makeResolveForThread(resolve, {
      getThreadShellById: (threadId) => projectionSnapshotQuery.getThreadShellById(threadId),
      getProjectShellById: (projectId) => projectionSnapshotQuery.getProjectShellById(projectId),
    }),
  } satisfies LaunchEnvShape;
});

export const LaunchEnvLive = Layer.effect(LaunchEnv, makeLaunchEnv());
