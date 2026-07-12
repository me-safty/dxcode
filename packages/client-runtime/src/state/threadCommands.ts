import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  type AtomCommand,
  type AtomCommandResult,
  createAtomCommandScheduler,
  createEnvironmentCommand,
} from "./runtime.ts";
import {
  type ArchiveThreadInput,
  type CreateThreadInput,
  type DeleteThreadInput,
  type InterruptThreadTurnInput,
  type ForkThreadFromRunInput,
  type MergeThreadBackInput,
  type PromoteQueuedRunInput,
  type ReorderQueuedRunInput,
  type RespondToThreadApprovalInput,
  type RespondToThreadUserInputInput,
  type RevertThreadCheckpointInput,
  type SetThreadInteractionModeInput,
  type SetThreadRuntimeModeInput,
  type StartThreadTurnInput,
  type StopThreadSessionInput,
  type UnarchiveThreadInput,
  type UpdateThreadMetadataInput,
  archiveThread,
  createThread,
  deleteThread,
  interruptThreadTurn,
  forkThreadFromRun,
  mergeThreadBack,
  promoteQueuedRun,
  reorderQueuedRun,
  respondToThreadApproval,
  respondToThreadUserInput,
  revertThreadCheckpoint,
  setThreadInteractionMode,
  setThreadRuntimeMode,
  startThreadTurn,
  stopThreadSession,
  ThreadTurnNotInterruptibleError,
  unarchiveThread,
  updateThreadMetadata,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export type ThreadCommandLane = "control" | "mutation";

export function threadCommandConcurrencyKey(
  lane: ThreadCommandLane,
  { environmentId, input }: { environmentId: string; input: { threadId: string } },
): string {
  return JSON.stringify([environmentId, input.threadId, lane]);
}

export type {
  ArchiveThreadInput,
  CreateThreadInput,
  DeleteThreadInput,
  InterruptThreadTurnInput,
  ForkThreadFromRunInput,
  MergeThreadBackInput,
  PromoteQueuedRunInput,
  ReorderQueuedRunInput,
  RespondToThreadApprovalInput,
  RespondToThreadUserInputInput,
  RevertThreadCheckpointInput,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
  StopThreadSessionInput,
  ThreadCommandInput,
  UnarchiveThreadInput,
  UpdateThreadMetadataInput,
} from "../operations/commands.ts";
export { ThreadTurnNotInterruptibleError } from "../operations/commands.ts";

interface ThreadCommandTarget {
  readonly environmentId: string;
  readonly input: { readonly threadId: string };
}

const isThreadTurnNotInterruptibleError = Schema.is(ThreadTurnNotInterruptibleError);

function isThreadTurnNotInterruptibleFailure(result: AtomCommandResult<unknown, unknown>): boolean {
  return result._tag === "Failure" && isThreadTurnNotInterruptibleError(Cause.squash(result.cause));
}

/**
 * Keeps `interruptTurn` on its own fast control lane while closing the
 * Send-then-quick-Stop race: when an interrupt finds no active run but a
 * `startTurn` for the same thread was still in flight when the interrupt was
 * issued, the interrupt waits for that specific start to settle and retries
 * once, so it targets the run the pending send creates instead of failing
 * against a stale projection.
 */
export function coordinateInterruptWithPendingStarts<
  StartTarget extends ThreadCommandTarget,
  InterruptTarget extends ThreadCommandTarget,
  SA,
  SE,
  IA,
  IE,
>(commands: {
  readonly startTurn: AtomCommand<StartTarget, SA, SE>;
  readonly interruptTurn: AtomCommand<InterruptTarget, IA, IE>;
}): {
  readonly startTurn: AtomCommand<StartTarget, SA, SE>;
  readonly interruptTurn: AtomCommand<InterruptTarget, IA, IE>;
} {
  const pendingStarts = new WeakMap<
    AtomRegistry.AtomRegistry,
    Map<string, Set<Promise<unknown>>>
  >();
  const pendingKey = (target: ThreadCommandTarget) =>
    JSON.stringify([target.environmentId, target.input.threadId]);

  return {
    startTurn: {
      label: commands.startTurn.label,
      run: (registry, input) => {
        let byThread = pendingStarts.get(registry);
        if (byThread === undefined) {
          byThread = new Map();
          pendingStarts.set(registry, byThread);
        }
        const key = pendingKey(input);
        let inFlight = byThread.get(key);
        if (inFlight === undefined) {
          inFlight = new Set();
          byThread.set(key, inFlight);
        }
        const active = inFlight;
        const threads = byThread;
        const result = commands.startTurn.run(registry, input);
        active.add(result);
        const settle = () => {
          active.delete(result);
          if (active.size === 0 && threads.get(key) === active) {
            threads.delete(key);
          }
        };
        void result.then(settle, settle);
        return result;
      },
    },
    interruptTurn: {
      label: commands.interruptTurn.label,
      run: async (registry, input) => {
        // A start that settled before this interrupt was issued may still
        // have its cleanup queued as a microtask. Yield once so those
        // cleanups drain (they were queued earlier, so they run first) and
        // the snapshot only contains starts genuinely in flight — a stale
        // entry must not trigger a retry that could interrupt a later,
        // unrelated start.
        await Promise.resolve();
        const startsAtDispatch = Array.from(
          pendingStarts.get(registry)?.get(pendingKey(input)) ?? [],
        );
        const result = await commands.interruptTurn.run(registry, input);
        if (startsAtDispatch.length === 0 || !isThreadTurnNotInterruptibleFailure(result)) {
          return result;
        }
        // The mutation lane is serial per thread, so only the earliest
        // pending start is in flight; retry as soon as any start settles
        // instead of waiting behind the whole queued send backlog.
        await Promise.race(
          startsAtDispatch.map((start) =>
            start.then(
              () => undefined,
              () => undefined,
            ),
          ),
        );
        return commands.interruptTurn.run(registry, input);
      },
    },
  };
}

export function createThreadEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: (input: { environmentId: string; input: { threadId: string } }) =>
      threadCommandConcurrencyKey("mutation", input),
  };
  const controlConcurrency = {
    mode: "serial" as const,
    key: (input: { environmentId: string; input: { threadId: string } }) =>
      threadCommandConcurrencyKey("control", input),
  };
  const turnLifecycle = coordinateInterruptWithPendingStarts({
    startTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:start-turn",
      execute: (input: StartThreadTurnInput) => startThreadTurn(input),
      scheduler,
      concurrency,
    }),
    interruptTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:interrupt-turn",
      execute: (input: InterruptThreadTurnInput) => interruptThreadTurn(input),
      scheduler,
      concurrency: controlConcurrency,
    }),
  });
  return {
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:create",
      execute: (input: CreateThreadInput) => createThread(input),
      scheduler,
      concurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:delete",
      execute: (input: DeleteThreadInput) => deleteThread(input),
      scheduler,
      concurrency,
    }),
    archive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:archive",
      execute: (input: ArchiveThreadInput) => archiveThread(input),
      scheduler,
      concurrency,
    }),
    unarchive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unarchive",
      execute: (input: UnarchiveThreadInput) => unarchiveThread(input),
      scheduler,
      concurrency,
    }),
    updateMetadata: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:update-metadata",
      execute: (input: UpdateThreadMetadataInput) => updateThreadMetadata(input),
      scheduler,
      concurrency,
    }),
    setRuntimeMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-runtime-mode",
      execute: (input: SetThreadRuntimeModeInput) => setThreadRuntimeMode(input),
      scheduler,
      concurrency,
    }),
    setInteractionMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-interaction-mode",
      execute: (input: SetThreadInteractionModeInput) => setThreadInteractionMode(input),
      scheduler,
      concurrency,
    }),
    startTurn: turnLifecycle.startTurn,
    interruptTurn: turnLifecycle.interruptTurn,
    respondToApproval: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-approval",
      execute: (input: RespondToThreadApprovalInput) => respondToThreadApproval(input),
      scheduler,
      concurrency,
    }),
    respondToUserInput: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-user-input",
      execute: (input: RespondToThreadUserInputInput) => respondToThreadUserInput(input),
      scheduler,
      concurrency,
    }),
    revertCheckpoint: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:revert-checkpoint",
      execute: (input: RevertThreadCheckpointInput) => revertThreadCheckpoint(input),
      scheduler,
      concurrency,
    }),
    stopSession: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:stop-session",
      execute: (input: StopThreadSessionInput) => stopThreadSession(input),
      scheduler,
      concurrency: controlConcurrency,
    }),
    forkFromRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:fork-from-run",
      execute: (input: ForkThreadFromRunInput) => forkThreadFromRun(input),
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.sourceThreadId]),
      },
    }),
    mergeBack: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:merge-back",
      execute: (input: MergeThreadBackInput) => mergeThreadBack(input),
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.sourceThreadId, input.targetThreadId]),
      },
    }),
    reorderQueuedRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:reorder-queued-run",
      execute: (input: ReorderQueuedRunInput) => reorderQueuedRun(input),
      scheduler,
      concurrency,
    }),
    promoteQueuedRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:promote-queued-run",
      execute: (input: PromoteQueuedRunInput) => promoteQueuedRun(input),
      scheduler,
      concurrency,
    }),
  };
}
