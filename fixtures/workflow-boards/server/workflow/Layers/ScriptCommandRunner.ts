import type { TerminalAttachStreamEvent, TerminalSessionSnapshot } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { WorkflowEventStoreError } from "../Services/Errors.ts";
import {
  ScriptCommandRunner,
  type ScriptCommandResult,
  type ScriptCommandRunnerShape,
} from "../Services/ScriptCommandRunner.ts";
import { WorkflowTerminalsCapability } from "../Services/ScriptCancelRegistry.ts";

const toRunnerError = (message: string) => (cause: unknown) =>
  new WorkflowEventStoreError({ message, cause });

const timeoutResult = {
  outcome: "timeout",
  exitCode: null,
  signal: null,
} satisfies ScriptCommandResult;

const cancelledResult = {
  outcome: "cancelled",
  exitCode: null,
  signal: null,
} satisfies ScriptCommandResult;

const exitedResult = (exitCode: number | null, signal: number | null): ScriptCommandResult => ({
  outcome: "exited",
  exitCode: exitCode ?? 1,
  signal,
});

const settleSnapshot = (
  snapshot: TerminalSessionSnapshot,
  complete: (result: ScriptCommandResult) => Effect.Effect<void>,
) =>
  snapshot.status === "exited"
    ? complete(exitedResult(snapshot.exitCode, snapshot.exitSignal))
    : Effect.void;

const make = Effect.gen(function* () {
  const terminals = yield* WorkflowTerminalsCapability;

  const run: ScriptCommandRunnerShape["run"] = (input) =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<ScriptCommandResult, WorkflowEventStoreError>();
      const complete = (result: ScriptCommandResult) =>
        Deferred.succeed(done, result).pipe(Effect.asVoid);
      const fail = (message: string) =>
        Deferred.fail(done, new WorkflowEventStoreError({ message })).pipe(Effect.asVoid);

      const spawned = yield* terminals
        .spawn({
          cwd: input.cwd,
          terminalId: input.terminalId,
          command: "sh",
          args: ["-c", input.run],
        })
        .pipe(Effect.mapError(toRunnerError("script terminal spawn failed")));

      const handle = spawned.handle;
      const closeTerminal = terminals.kill(handle).pipe(Effect.ignore);

      const onEvent = (event: TerminalAttachStreamEvent) => {
        if (event.type === "snapshot") {
          return settleSnapshot(event.snapshot, complete);
        }
        if (event.type === "exited") {
          return complete(exitedResult(event.exitCode, event.exitSignal));
        }
        if (event.type === "error") {
          return fail(`script terminal error: ${event.message}`);
        }
        if (event.type === "closed") {
          return complete(cancelledResult);
        }
        return Effect.void;
      };

      const unsubscribe = yield* terminals
        .observe(handle, onEvent)
        .pipe(Effect.mapError(toRunnerError("script terminal observe failed")));
      yield* settleSnapshot(spawned.snapshot, complete);
      yield* terminals.sendInput({ ...handle, data: "exit $?\r" }).pipe(Effect.ignore);

      return yield* Deferred.await(done).pipe(
        Effect.timeoutOption(input.timeout),
        Effect.flatMap((result) =>
          Option.match(result, {
            onNone: () => closeTerminal.pipe(Effect.as(timeoutResult)),
            onSome: Effect.succeed,
          }),
        ),
        Effect.onInterrupt(() => closeTerminal),
        Effect.ensuring(Effect.sync(unsubscribe)),
      );
    });

  return { run } satisfies ScriptCommandRunnerShape;
});

export const ScriptCommandRunnerLive = Layer.effect(ScriptCommandRunner, make);
