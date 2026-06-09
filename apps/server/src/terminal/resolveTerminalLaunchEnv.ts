import {
  ProjectId,
  ThreadId,
  type TerminalAttachInput,
  type TerminalOpenInput,
  type TerminalRestartInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { LaunchEnv, type LaunchEnvShape } from "../launchEnv/Services/LaunchEnv.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TerminalCwdError, TerminalSessionLookupError } from "./Services/Manager.ts";

export type TerminalAttachRuntimeInput = TerminalAttachInput & {
  readonly projectId: ProjectId;
};

export type TerminalLaunchEnvProjectionShape = Pick<
  ProjectionSnapshotQueryShape,
  "getProjectShellById" | "getThreadShellById"
>;

export class TerminalLaunchEnvProjection extends Context.Service<
  TerminalLaunchEnvProjection,
  TerminalLaunchEnvProjectionShape
>()("t3/terminal/TerminalLaunchEnvProjection") {}

export interface TerminalLaunchEnvResolver {
  readonly resolveOpenInput: (
    input: TerminalOpenInput,
  ) => Effect.Effect<TerminalOpenInput, TerminalCwdError | TerminalSessionLookupError>;
  readonly resolveRestartInput: (
    input: TerminalRestartInput,
  ) => Effect.Effect<TerminalRestartInput, TerminalCwdError | TerminalSessionLookupError>;
  readonly resolveAttachInput: (
    input: TerminalAttachInput,
  ) => Effect.Effect<TerminalAttachRuntimeInput, TerminalCwdError | TerminalSessionLookupError>;
}

export interface ResolveTerminalLaunchEnvInput {
  readonly projectId: ProjectId;
  readonly threadId: string;
  readonly worktreePath?: string | null;
  readonly extraEnv?: Record<string, string>;
}

type TerminalProjectContextInput = {
  readonly threadId: string;
  readonly terminalId: string;
  readonly projectId?: ProjectId;
  readonly worktreePath?: string | null | undefined;
};

type TerminalLaunchEnvResolverServices = LaunchEnv | TerminalLaunchEnvProjection;

const terminalSessionLookupError = (input: {
  readonly threadId: string;
  readonly terminalId: string;
}) =>
  new TerminalSessionLookupError({
    threadId: input.threadId,
    terminalId: input.terminalId,
  });

const provideTerminalLaunchEnvResolverServices = <A, E>(
  services: Context.Context<TerminalLaunchEnvResolverServices>,
  effect: Effect.Effect<A, E, TerminalLaunchEnvResolverServices>,
) => effect.pipe(Effect.provide(services));

const resolveProjectContextForTerminal = Effect.fn("resolveProjectContextForTerminal")(function* (
  input: TerminalProjectContextInput,
) {
  const projection = yield* TerminalLaunchEnvProjection;

  const threadOption = yield* projection
    .getThreadShellById(ThreadId.make(input.threadId))
    .pipe(Effect.mapError(() => terminalSessionLookupError(input)));

  return yield* Option.match(threadOption, {
    onSome: (thread) =>
      Effect.succeed({
        projectId: thread.projectId,
        worktreePath: input.worktreePath !== undefined ? input.worktreePath : thread.worktreePath,
      }),
    onNone: () => {
      if (input.projectId === undefined) {
        return Effect.fail(terminalSessionLookupError(input));
      }

      return Effect.succeed({
        projectId: input.projectId,
        ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
      });
    },
  });
});

export const resolveTerminalLaunchEnv = Effect.fn("resolveTerminalLaunchEnv")(function* (
  input: ResolveTerminalLaunchEnvInput,
) {
  const projection = yield* TerminalLaunchEnvProjection;
  const launchEnv = yield* LaunchEnv;
  const projectId = input.projectId;

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

  return yield* launchEnv.resolve({
    ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
    projectRoot: project.workspaceRoot,
    projectId: project.id,
    threadId: input.threadId,
    ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
  });
});

const resolveLaunchEnvForTerminalInput = Effect.fn("resolveLaunchEnvForTerminalInput")(function* (
  input: TerminalProjectContextInput & { readonly env?: Readonly<Record<string, string>> },
) {
  const { projectId, worktreePath } = yield* resolveProjectContextForTerminal(input);

  const env = yield* resolveTerminalLaunchEnv({
    projectId,
    threadId: input.threadId,
    ...(worktreePath !== undefined ? { worktreePath } : {}),
    ...(input.env !== undefined ? { extraEnv: input.env } : {}),
  });

  return {
    worktreePath,
    env,
  };
});

const terminalLaunchEnvInput = (
  input: Pick<TerminalOpenInput, "threadId" | "terminalId" | "projectId" | "worktreePath" | "env">,
) => ({
  threadId: input.threadId,
  terminalId: input.terminalId,
  ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
  ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
  ...(input.env !== undefined ? { env: input.env } : {}),
});

export const resolveTerminalOpenInput = Effect.fn("resolveTerminalOpenInput")(function* (
  input: TerminalOpenInput,
) {
  const { worktreePath, env } = yield* resolveLaunchEnvForTerminalInput(
    terminalLaunchEnvInput(input),
  );

  return {
    ...input,
    ...(worktreePath !== undefined ? { worktreePath } : {}),
    env,
  };
});

export const resolveTerminalRestartInput = Effect.fn("resolveTerminalRestartInput")(function* (
  input: TerminalRestartInput,
) {
  const { worktreePath, env } = yield* resolveLaunchEnvForTerminalInput(
    terminalLaunchEnvInput(input),
  );

  return {
    ...input,
    ...(worktreePath !== undefined ? { worktreePath } : {}),
    env,
  };
});

export const resolveTerminalAttachInput = Effect.fn("resolveTerminalAttachInput")(function* (
  input: TerminalAttachInput,
) {
  const { projectId, worktreePath } = yield* resolveProjectContextForTerminal({
    threadId: input.threadId,
    terminalId: input.terminalId,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
  });

  const env = yield* resolveTerminalLaunchEnv({
    projectId,
    threadId: input.threadId,
    ...(worktreePath !== undefined ? { worktreePath } : {}),
    ...(input.env !== undefined ? { extraEnv: input.env } : {}),
  });

  return {
    ...input,
    projectId,
    ...(worktreePath !== undefined ? { worktreePath } : {}),
    env,
  } satisfies TerminalAttachRuntimeInput;
});

export const bindTerminalLaunchEnvResolver = (
  launchEnv: LaunchEnvShape,
  projection: TerminalLaunchEnvProjectionShape,
): TerminalLaunchEnvResolver => {
  const services = Context.make(LaunchEnv, launchEnv).pipe(
    Context.add(TerminalLaunchEnvProjection, projection),
  );

  return {
    resolveOpenInput: (input) =>
      provideTerminalLaunchEnvResolverServices(services, resolveTerminalOpenInput(input)),
    resolveRestartInput: (input) =>
      provideTerminalLaunchEnvResolverServices(services, resolveTerminalRestartInput(input)),
    resolveAttachInput: (input) =>
      provideTerminalLaunchEnvResolverServices(services, resolveTerminalAttachInput(input)),
  };
};
