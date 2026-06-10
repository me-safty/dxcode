/**
 * LaunchEnvLive - Layer implementation for LaunchEnv service.
 *
 * Provides the LaunchEnv service via Effect Layer. Depends on ServerConfig
 * and ProjectionSnapshotQuery (auto-wired from context).
 *
 * @module LaunchEnvLive
 */
import { TerminalCwdError, TerminalSessionLookupError, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../../config.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { LaunchEnv, type LaunchEnvShape, type LaunchEnvProjectionShape } from "../Services/LaunchEnv.ts";
import { mergeResolvedLaunchEnv } from "../launchEnvUtils.ts";

/**
 * Create resolve function for launch environment.
 * @internal
 */
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

/**
 * Create resolveForThread function for launch environment.
 * @internal
 */
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
    } as const;
  });

/**
 * Create LaunchEnv service implementation.
 * @internal
 */
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

/**
 * LaunchEnvLive - Layer providing LaunchEnv service.
 *
 * Automatically wires ServerConfig and ProjectionSnapshotQuery from context.
 */
export const LaunchEnvLive = Layer.effect(LaunchEnv, makeLaunchEnv());
