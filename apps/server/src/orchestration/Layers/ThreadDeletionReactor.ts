import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProviderEventLoggers } from "../../provider/Layers/ProviderEventLoggers.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadColdStorage } from "../Services/ThreadColdStorage.ts";
import {
  ThreadDeletionReactor,
  type ThreadDeletionReactorShape,
} from "../Services/ThreadDeletionReactor.ts";

type ThreadDeletedEvent = Extract<OrchestrationEvent, { type: "thread.deleted" }>;
type ThreadArchivedEvent = Extract<OrchestrationEvent, { type: "thread.archived" }>;
type ThreadLifecycleJob =
  | { readonly type: "archive"; readonly threadId: ThreadArchivedEvent["payload"]["threadId"] }
  | { readonly type: "delete"; readonly threadId: ThreadDeletedEvent["payload"]["threadId"] }
  | { readonly type: "compact-legacy-storage" };

export const logCleanupCauseUnlessInterrupted = <R, E>({
  effect,
  message,
  threadId,
}: {
  readonly effect: Effect.Effect<void, E, R>;
  readonly message: string;
  readonly threadId: ThreadDeletedEvent["payload"]["threadId"];
}): Effect.Effect<void, E, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logDebug(message, {
        threadId,
        cause: Cause.pretty(cause),
      });
    }),
  );

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const terminalManager = yield* TerminalManager.TerminalManager;
  const threadColdStorage = yield* ThreadColdStorage;
  const providerEventLoggers = yield* ProviderEventLoggers;

  const stopProviderSession = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: providerService.stopSession({ threadId }),
      message: "thread deletion cleanup skipped provider session stop",
      threadId,
    });

  const closeThreadTerminals = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: terminalManager.close({ threadId, deleteHistory: true }),
      message: "thread deletion cleanup skipped terminal close",
      threadId,
    });

  const closeProviderLogWriters = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: Effect.all(
        [providerEventLoggers.native, providerEventLoggers.canonical].flatMap((logger) =>
          logger?.closeThread ? [logger.closeThread(threadId)] : [],
        ),
        { discard: true },
      ),
      message: "thread lifecycle cleanup skipped provider log writer close",
      threadId,
    });

  const processLifecycleJob = Effect.fn("processThreadLifecycleJob")(function* (
    job: ThreadLifecycleJob,
  ) {
    if (job.type === "compact-legacy-storage") {
      yield* threadColdStorage.compactLegacyStorage;
      return;
    }
    const { threadId } = job;
    yield* stopProviderSession(threadId);
    yield* closeThreadTerminals(threadId);
    yield* closeProviderLogWriters(threadId);
    if (job.type === "archive") {
      yield* threadColdStorage.archiveThread(threadId);
    } else {
      yield* threadColdStorage.deleteThread(threadId);
    }
  });

  const processLifecycleJobSafely = (job: ThreadLifecycleJob) =>
    processLifecycleJob(job).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("thread lifecycle reactor failed to process job", {
          lifecycleAction: job.type,
          ...(job.type === "compact-legacy-storage" ? {} : { threadId: job.threadId }),
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processLifecycleJobSafely);

  const start: ThreadDeletionReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type === "thread.deleted") {
          return worker.enqueue({ type: "delete", threadId: event.payload.threadId });
        }
        if (event.type === "thread.archived") {
          return worker.enqueue({ type: "archive", threadId: event.payload.threadId });
        }
        return Effect.void;
      }),
    );

    const pendingJobs = yield* Effect.all([
      threadColdStorage.listPendingDeleteThreadIds,
      threadColdStorage.listPendingArchiveThreadIds,
    ]).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to read pending thread storage migrations", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(null)),
      ),
    );
    if (pendingJobs === null) return;
    const [pendingDeletes, pendingArchives] = pendingJobs;
    yield* Effect.forEach(
      pendingDeletes,
      (threadId) => worker.enqueue({ type: "delete", threadId }),
      { discard: true },
    );
    yield* Effect.forEach(
      pendingArchives,
      (threadId) => worker.enqueue({ type: "archive", threadId }),
      { discard: true },
    );
    yield* worker.enqueue({ type: "compact-legacy-storage" });
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadDeletionReactorShape;
});

export const ThreadDeletionReactorLive = Layer.effect(ThreadDeletionReactor, make);
