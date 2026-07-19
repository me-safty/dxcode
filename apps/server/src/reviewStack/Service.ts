import * as NodeCrypto from "node:crypto";

import {
  ReviewStackError,
  ReviewStackSnapshotId,
  type ReviewStackEnsureInput,
  type ReviewStackEvent,
  type ReviewStackGetSnapshotInput,
  type ReviewStackListSnapshotsInput,
  type ReviewStackSnapshot,
  type ReviewStackSnapshotMetadata,
  type ReviewStackTarget,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ReviewService from "../review/ReviewService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { parseReviewStackAnchors } from "./Anchors.ts";
import { captureRepositoryReviewSource } from "./RepositoryReviewSource.ts";
import * as Repository from "./Repository.ts";
import { validateReviewStackDocument } from "./Validation.ts";

interface ResolvedSource {
  cwd: string;
  diff: string;
  truncated: boolean;
  resolvedBase: string | null;
}

export class ReviewStackService extends Context.Service<
  ReviewStackService,
  {
    readonly ensure: (
      input: ReviewStackEnsureInput,
    ) => Effect.Effect<ReviewStackSnapshotMetadata, ReviewStackError>;
    readonly listSnapshots: (
      input: ReviewStackListSnapshotsInput,
    ) => Effect.Effect<ReadonlyArray<ReviewStackSnapshotMetadata>, ReviewStackError>;
    readonly getSnapshot: (
      input: ReviewStackGetSnapshotInput,
    ) => Effect.Effect<ReviewStackSnapshot, ReviewStackError>;
    readonly cancel: (
      input: ReviewStackGetSnapshotInput,
    ) => Effect.Effect<ReviewStackSnapshotMetadata, ReviewStackError>;
    readonly events: Stream.Stream<ReviewStackEvent>;
  }
>()("t3/reviewStack/Service/ReviewStackService") {}

const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const error = (operation: string, message: string) => new ReviewStackError({ operation, message });

function scopeKey(
  target: ReviewStackTarget,
  resolvedBase: string | null,
  ignoreWhitespace: boolean,
): string {
  return JSON.stringify({ target, resolvedBase, ignoreWhitespace });
}

export const make = Effect.gen(function* () {
  const repository = yield* Repository.ReviewStackRepository;
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const review = yield* ReviewService.ReviewService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const checkpoints = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const settings = yield* ServerSettings.ServerSettingsService;
  const semaphore = yield* Semaphore.make(2);
  const pubsub = yield* PubSub.unbounded<ReviewStackEvent>();
  const jobScope = yield* Scope.make("sequential");
  const jobs = new Map<string, Fiber.Fiber<void, never>>();
  const activeJobs = new Set<string>();
  yield* Effect.addFinalizer(() => Scope.close(jobScope, Exit.void));

  const publish = (metadata: ReviewStackSnapshotMetadata) =>
    PubSub.publish(pubsub, {
      snapshotId: metadata.snapshotId,
      threadId: metadata.threadId,
      status: metadata.status,
      stage: metadata.stage,
      updatedAt: metadata.updatedAt,
    }).pipe(Effect.asVoid);

  const requireSnapshot = Effect.fn("ReviewStackService.requireSnapshot")(function* (
    threadId: ReviewStackGetSnapshotInput["threadId"],
    snapshotId: ReviewStackGetSnapshotInput["snapshotId"],
  ) {
    const snapshot = yield* repository.get(threadId, snapshotId);
    if (!snapshot) return yield* error("getSnapshot", "Review stack snapshot not found.");
    return snapshot;
  });

  const resolveWorkspace = Effect.fn("ReviewStackService.resolveWorkspace")(function* (
    threadId: ReviewStackEnsureInput["threadId"],
  ) {
    const thread = yield* projection
      .getThreadShellById(threadId)
      .pipe(Effect.mapError((cause) => error("resolveWorkspace", String(cause))));
    if (Option.isNone(thread)) return yield* error("resolveWorkspace", "Thread not found.");
    const project = yield* projection
      .getProjectShellById(thread.value.projectId)
      .pipe(Effect.mapError((cause) => error("resolveWorkspace", String(cause))));
    if (Option.isNone(project)) return yield* error("resolveWorkspace", "Project not found.");
    return thread.value.worktreePath ?? project.value.workspaceRoot;
  });

  const resolveSource = Effect.fn("ReviewStackService.resolveSource")(function* (
    input: ReviewStackEnsureInput,
  ): Effect.fn.Return<ResolvedSource, ReviewStackError> {
    const cwd = yield* resolveWorkspace(input.threadId);
    if (input.target._tag === "turn") {
      const result = yield* checkpoints
        .getTurnDiff({
          threadId: input.threadId,
          fromTurnCount: input.target.fromTurnCount,
          toTurnCount: input.target.toTurnCount,
          ignoreWhitespace: input.ignoreWhitespace,
        })
        .pipe(Effect.mapError((cause) => error("resolveTurn", String(cause))));
      return { cwd, diff: result.diff, truncated: false, resolvedBase: null };
    }

    const selection =
      input.target._tag === "commit"
        ? ({ _tag: "commit", sha: input.target.sha } as const)
        : ({ _tag: "all" } as const);
    const preview = yield* review
      .getDiffPreview({
        cwd,
        ignoreWhitespace: input.ignoreWhitespace,
        selection,
        ...(input.target._tag === "branch" && input.target.baseRef !== null
          ? { baseRef: input.target.baseRef }
          : {}),
      })
      .pipe(Effect.mapError((cause) => error("resolveDiff", String(cause))));
    const source =
      input.target._tag === "branch"
        ? preview.sources.find((candidate) => candidate.id === "branch-range")
        : preview.sources[0];
    const resolvedBase = source?.baseRef ?? null;
    const captured = yield* captureRepositoryReviewSource({
      cwd: preview.cwd,
      target: input.target,
      resolvedBase,
      ignoreWhitespace: input.ignoreWhitespace,
      git,
    }).pipe(Effect.mapError((cause) => error("captureReviewSource", cause.message)));
    return {
      cwd: preview.cwd,
      diff: captured.diff,
      truncated: false,
      resolvedBase,
    };
  });

  const setState = Effect.fn("ReviewStackService.setState")(function* (
    snapshot: ReviewStackSnapshot,
    state: Parameters<Repository.ReviewStackRepository["Service"]["update"]>[0],
  ) {
    yield* repository.update(state);
    const updated = yield* requireSnapshot(
      snapshot.metadata.threadId,
      snapshot.metadata.snapshotId,
    );
    yield* publish(updated.metadata);
    return updated;
  });

  const setTerminalState = (
    snapshot: ReviewStackSnapshot,
    status: "cancelled" | "failed",
    errorMessage?: string,
  ) =>
    now.pipe(
      Effect.flatMap((completedAt) =>
        repository.update({
          snapshotId: snapshot.metadata.snapshotId,
          status,
          stage: status,
          ...(errorMessage === undefined ? {} : { errorMessage }),
          completedAt,
          updatedAt: completedAt,
        }),
      ),
      Effect.flatMap(() =>
        requireSnapshot(snapshot.metadata.threadId, snapshot.metadata.snapshotId),
      ),
      Effect.tap((updated) => publish(updated.metadata)),
      Effect.asVoid,
    );

  const runJob = Effect.fn("ReviewStackService.runJob")(function* (snapshot: ReviewStackSnapshot) {
    const id = snapshot.metadata.snapshotId;
    const startedAt = yield* now;
    const running = yield* setState(snapshot, {
      snapshotId: id,
      status: "running",
      stage: "analyzing",
      startedAt,
      updatedAt: startedAt,
      errorMessage: null,
    });
    const cwd =
      running.sourceDiff.length > 0 ? yield* resolveWorkspace(running.metadata.threadId) : ".";
    const generateAndValidate = Effect.fn("ReviewStackService.generateAndValidate")(
      function* (): Effect.fn.Return<ReviewStackSnapshot["review"], ReviewStackError> {
        const generated = yield* textGeneration
          .generateReviewStack({
            cwd,
            sourceDiff: running.sourceDiff,
            anchorCatalog: running.anchorCatalog,
            instructions: running.instructions,
            modelSelection: running.metadata.modelSelection,
          })
          .pipe(Effect.mapError((cause) => error("reviewAgent", cause.message)));
        const validated = yield* Effect.try({
          try: () => validateReviewStackDocument(generated, running.anchorCatalog),
          catch: (cause) =>
            error("validate", cause instanceof Error ? cause.message : String(cause)),
        });
        if (validated === null) return yield* error("validate", "Review output was empty.");
        return validated;
      },
    );
    const document = yield* generateAndValidate().pipe(Effect.retry({ times: 2 }));
    const validating = yield* setState(running, {
      snapshotId: id,
      status: "running",
      stage: "validating",
      updatedAt: yield* now,
    });
    const saving = yield* setState(validating, {
      snapshotId: id,
      status: "running",
      stage: "saving",
      updatedAt: yield* now,
    });
    const completedAt = yield* now;
    yield* setState(saving, {
      snapshotId: id,
      status: "completed",
      stage: "completed",
      review: document,
      completedAt,
      updatedAt: completedAt,
    });
  });

  const launch = Effect.fn("ReviewStackService.launch")(function* (snapshot: ReviewStackSnapshot) {
    if (activeJobs.has(snapshot.metadata.snapshotId)) return;
    activeJobs.add(snapshot.metadata.snapshotId);
    const program = semaphore.withPermit(runJob(snapshot)).pipe(
      Effect.catch((cause) =>
        setTerminalState(
          snapshot,
          "failed",
          cause instanceof Error ? cause.message : String(cause),
        ).pipe(Effect.ignore),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          activeJobs.delete(snapshot.metadata.snapshotId);
          jobs.delete(snapshot.metadata.snapshotId);
        }),
      ),
    );
    const start = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkIn(
      Deferred.await(start).pipe(Effect.andThen(program)),
      jobScope,
    );
    jobs.set(snapshot.metadata.snapshotId, fiber);
    yield* Deferred.succeed(start, undefined);
  });

  const ensure: ReviewStackService["Service"]["ensure"] = Effect.fn("ReviewStackService.ensure")(
    function* (input) {
      const source = yield* resolveSource(input);
      const key = scopeKey(input.target, source.resolvedBase, input.ignoreWhitespace);
      const sourceHash = hash(source.diff);
      if (input.force !== true) {
        const reusable = yield* repository.findReusable(input.threadId, key, sourceHash);
        if (reusable) {
          if (reusable.metadata.status !== "completed") yield* launch(reusable);
          return reusable.metadata;
        }
      }
      const currentSettings = yield* settings.getSettings.pipe(
        Effect.mapError((cause) => error("settings", String(cause))),
      );
      const createdAt = yield* now;
      const snapshotId = ReviewStackSnapshotId.make(NodeCrypto.randomUUID());
      const anchors = parseReviewStackAnchors(source.diff);
      yield* repository
        .insert({
          snapshotId,
          threadId: input.threadId,
          scopeKey: key,
          target: input.target,
          sourceHash,
          sourceDiff: source.diff,
          anchorCatalog: anchors,
          sourceTruncated: source.truncated,
          modelSelection: currentSettings.reviewStackModelSelection,
          instructions: currentSettings.reviewStackInstructions,
          createdAt,
        })
        .pipe(
          Effect.catch(() =>
            repository
              .findReusable(input.threadId, key, sourceHash)
              .pipe(
                Effect.flatMap((existing) =>
                  existing
                    ? Effect.void
                    : Effect.fail(error("insert", "Failed to create snapshot.")),
                ),
              ),
          ),
        );
      const snapshot = yield* requireSnapshot(input.threadId, snapshotId).pipe(
        Effect.catch(() =>
          repository
            .findReusable(input.threadId, key, sourceHash)
            .pipe(
              Effect.flatMap((existing) =>
                existing
                  ? Effect.succeed(existing)
                  : Effect.fail(error("ensure", "Snapshot unavailable.")),
              ),
            ),
        ),
      );
      if (anchors.length === 0) {
        const completedAt = yield* now;
        const completed = yield* setState(snapshot, {
          snapshotId: snapshot.metadata.snapshotId,
          status: "completed",
          stage: "completed",
          review: { summary: "No changes.", layers: [] },
          completedAt,
          updatedAt: completedAt,
        });
        return completed.metadata;
      }
      yield* launch(snapshot);
      return snapshot.metadata;
    },
  );

  const listSnapshots: ReviewStackService["Service"]["listSnapshots"] = Effect.fn(
    "ReviewStackService.listSnapshots",
  )(function* (input) {
    const source = yield* resolveSource(input);
    const snapshots = yield* repository.list(
      input.threadId,
      scopeKey(input.target, source.resolvedBase, input.ignoreWhitespace),
    );
    const currentHash = hash(source.diff);
    return snapshots.map((snapshot) => ({
      ...snapshot,
      isCurrent: snapshot.sourceHash === currentHash,
    }));
  });

  const getSnapshot: ReviewStackService["Service"]["getSnapshot"] = (input) =>
    requireSnapshot(input.threadId, input.snapshotId);

  const cancel: ReviewStackService["Service"]["cancel"] = Effect.fn("ReviewStackService.cancel")(
    function* (input) {
      const snapshot = yield* requireSnapshot(input.threadId, input.snapshotId);
      const fiber = jobs.get(input.snapshotId);
      if (fiber) yield* Fiber.interrupt(fiber);
      if (snapshot.metadata.status === "queued" || snapshot.metadata.status === "running") {
        yield* setTerminalState(snapshot, "cancelled");
      }
      const updated = yield* requireSnapshot(input.threadId, input.snapshotId);
      return updated.metadata;
    },
  );

  const recoverable = yield* repository.listRecoverable;
  for (const snapshot of recoverable) {
    yield* repository.update({
      snapshotId: snapshot.metadata.snapshotId,
      status: "queued",
      stage: "queued",
      updatedAt: yield* now,
    });
    yield* launch(snapshot);
  }

  return ReviewStackService.of({
    ensure,
    listSnapshots,
    getSnapshot,
    cancel,
    events: Stream.fromPubSub(pubsub),
  });
});

export const layer = Layer.effect(ReviewStackService, make);
