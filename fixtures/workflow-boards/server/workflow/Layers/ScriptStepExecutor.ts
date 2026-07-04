import { ThreadId } from "@t3tools/contracts";
import type { StepOutcome, WorkflowEventId } from "../../../contracts/workflow.ts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { WorkflowEventStoreError } from "../Services/Errors.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { ScriptCommandRunner } from "../Services/ScriptCommandRunner.ts";
import {
  ScriptStepExecutor,
  type ScriptStepExecutorShape,
} from "../Services/ScriptStepExecutor.ts";
import { WorkflowFilesystemCapability } from "../Services/WorkflowCapabilities.ts";
import { WorkflowEventCommitter } from "../Services/WorkflowEventCommitter.ts";
import { type WorkflowEventInput } from "../Services/WorkflowEventStore.ts";
import { WorkflowIds } from "../Services/WorkflowIds.ts";
import type { WorktreeHandle } from "../Services/WorktreePort.ts";

const DEFAULT_SCRIPT_TIMEOUT = Duration.minutes(10);
const PLUGIN_ID = "workflow-boards";

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const toScriptExecutorError = (message: string) => (cause: unknown) =>
  new WorkflowEventStoreError({ message, cause });

const mapCommandResult = (
  result: {
    readonly outcome: "exited" | "timeout" | "cancelled";
    readonly exitCode: number | null;
  },
  allowFailure: boolean,
): StepOutcome => {
  if (result.outcome === "timeout") {
    return { _tag: "failed", error: "script timed out" };
  }
  if (result.outcome === "cancelled") {
    return { _tag: "failed", error: "script cancelled", retryable: false };
  }
  if (result.exitCode === 0 || allowFailure) {
    return { _tag: "completed" };
  }
  return { _tag: "failed", error: `script exited with code ${result.exitCode ?? 1}` };
};

const isContainedRelative = (path: Path.Path, relative: string) =>
  relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

const make = Effect.gen(function* () {
  const cancels = yield* ScriptCancelRegistry;
  const commands = yield* ScriptCommandRunner;
  const committer = yield* WorkflowEventCommitter;
  const filesystem = yield* WorkflowFilesystemCapability;
  const ids = yield* WorkflowIds;
  const path = yield* Path.Path;

  const commit = (
    event: Omit<WorkflowEventInput, "eventId" | "occurredAt">,
  ): Effect.Effect<void, WorkflowEventStoreError> =>
    Effect.gen(function* () {
      const eventId = yield* ids.eventId();
      yield* committer.commit({
        ...event,
        eventId: eventId as WorkflowEventId,
        occurredAt: (yield* nowIso) as never,
      } as WorkflowEventInput);
    });

  const resolveContainedCwd = (worktree: WorktreeHandle, cwd: string | undefined) =>
    Effect.gen(function* () {
      const requested = cwd ?? ".";
      const relative = path.isAbsolute(requested)
        ? path.relative(worktree.path, requested)
        : requested;
      if (!isContainedRelative(path, relative)) {
        return { _tag: "failed", error: "script cwd escapes worktree" } as const;
      }
      const stat = yield* filesystem
        .stat({ root: worktree.path, relativePath: relative })
        .pipe(Effect.mapError(toScriptExecutorError("script cwd stat failed")));
      if (stat.type !== "directory") {
        return { _tag: "failed", error: "script cwd invalid" } as const;
      }
      // Use the resolved path validated by the filesystem capability, not the
      // caller's logical path, so symlink swaps cannot change the spawned cwd.
      return {
        _tag: "success",
        cwd: stat.realPath ?? path.join(worktree.path, relative),
      } as const;
    }).pipe(Effect.orElseSucceed(() => ({ _tag: "failed", error: "script cwd invalid" }) as const));

  const execute: ScriptStepExecutorShape["execute"] = (input) =>
    Effect.gen(function* () {
      const cwd = yield* resolveContainedCwd(input.worktree, input.step.cwd);
      if (cwd._tag === "failed") {
        return { _tag: "failed", error: cwd.error } satisfies StepOutcome;
      }

      const scriptRunId = yield* ids.scriptRunId();
      const terminalId = `script-${scriptRunId}`;
      const scriptThreadId = ThreadId.make(`plugin:${PLUGIN_ID}:${terminalId}`);

      yield* cancels.register(input.ctx.stepRunId, { scriptThreadId, terminalId });

      const result = yield* Effect.gen(function* () {
        yield* commit({
          type: "ScriptStepStarted",
          ticketId: input.ctx.ticketId,
          payload: {
            scriptRunId,
            stepRunId: input.ctx.stepRunId,
            scriptThreadId,
            terminalId,
          },
        });

        const commandResult = yield* commands.run({
          scriptThreadId,
          terminalId,
          cwd: cwd.cwd,
          run: input.step.run,
          timeout: input.step.timeout ?? DEFAULT_SCRIPT_TIMEOUT,
        });

        yield* commit({
          type: "ScriptStepExited",
          ticketId: input.ctx.ticketId,
          payload: {
            scriptRunId,
            exitCode: commandResult.exitCode,
            signal: commandResult.signal,
            outcome: commandResult.outcome,
          },
        });

        return commandResult;
      }).pipe(Effect.ensuring(cancels.unregister(input.ctx.stepRunId)));

      return mapCommandResult(result, input.step.allowFailure ?? false);
    });

  return { execute } satisfies ScriptStepExecutorShape;
});

export const ScriptStepExecutorLive = Layer.effect(ScriptStepExecutor, make);
