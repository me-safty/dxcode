/**
 * LaunchEnv - Service for resolving T3CODE_* environment variables.
 *
 * Owns centralized resolution of launch environment context including
 * project root, project ID, thread ID, and worktree paths. Consumed by
 * TerminalManager (for terminal spawning) and ProviderCommandReactor
 * (for provider session initialization).
 *
 * @module LaunchEnv
 */
import {
  ProjectId,
  TerminalCwdError,
  TerminalSessionLookupError,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { EnvRecord } from "../launchEnvUtils.ts";

/**
 * Input for resolving launch environment with explicit project context.
 */
export interface ResolveLaunchEnvInput {
  readonly projectRoot: string;
  readonly projectId: ProjectId | string;
  readonly threadId: string;
  readonly worktreePath?: string | null;
  readonly extraEnv?: EnvRecord;
}

/**
 * Input for resolving launch environment from thread context.
 */
export interface ResolveLaunchEnvForThreadInput {
  readonly threadId: string;
  readonly terminalId?: string | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly worktreePath?: string | null | undefined;
  readonly extraEnv?: EnvRecord;
}

/**
 * Resolved launch environment with project context and merged environment.
 */
export type ResolvedLaunchEnvForThread = {
  readonly projectId: ProjectId;
  readonly worktreePath?: string | null;
  readonly env: Record<string, string>;
};

/**
 * LaunchEnvShape - Service API for launch environment resolution.
 */
export interface LaunchEnvShape {
  /**
   * Resolve launch environment with explicit project context.
   */
  readonly resolve: (input: ResolveLaunchEnvInput) => Effect.Effect<Record<string, string>>;

  /**
   * Resolve launch environment from thread context (looks up thread in projection).
   */
  readonly resolveForThread: (
    input: ResolveLaunchEnvForThreadInput,
  ) => Effect.Effect<ResolvedLaunchEnvForThread, TerminalCwdError | TerminalSessionLookupError>;
}

/**
 * Internal projection shape for LaunchEnv implementation.
 * @internal
 */
export interface LaunchEnvProjectionShape {
  readonly getThreadShellById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, ProjectionRepositoryError>;
  readonly getProjectShellById: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectionRepositoryError>;
}

/**
 * LaunchEnv - Service tag for launch environment resolution.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const launchEnv = yield* LaunchEnv;
 *   const env = yield* launchEnv.resolveForThread({
 *     threadId: "my-thread",
 *     projectId: ProjectId.make("project-1"),
 *   });
 *   return env;
 * })
 * ```
 */
export class LaunchEnv extends Context.Service<LaunchEnv, LaunchEnvShape>()(
  "t3/launchEnv/Services/LaunchEnv",
) {}
