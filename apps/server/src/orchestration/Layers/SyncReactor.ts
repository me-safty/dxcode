/**
 * SyncReactor (live) - reacts to `thread.sync-requested` events.
 *
 * Performs a "sync with remote" against the thread's current branch:
 *   1. stash the working tree (including untracked) to isolate the user's WIP
 *   2. fetch the remote's default branch and merge it
 *   3. on conflict, resolve each conflicted file with a single-shot LLM call and
 *      create one merge commit (the server owns the commit boundary)
 *   4. reapply the stashed WIP on top
 *
 * Outcomes are surfaced as thread activities. On any failure mid-merge the merge
 * is aborted and the stash is restored, returning the workspace to its
 * pre-sync state.
 */
import {
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationEvent,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { isGitRepository } from "../../git/Utils.ts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { SyncReactor, type SyncReactorShape } from "../Services/SyncReactor.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const STASH_MESSAGE = "t3 sync-with-remote";
const STASH_REF = "stash@{0}";
// Files larger than this are not sent to the model for resolution — they're
// treated as unresolved so we never write back truncated content.
const MAX_CONFLICT_FILE_CHARS = 100_000;
const FAILURE_SUMMARY_MAX = 160;
// A NUL byte marks a binary file we shouldn't try to resolve as text.
const NUL_BYTE = String.fromCharCode(0);

// A leftover `<<<<<<<` or `>>>>>>>` line means the model did not fully resolve
// the conflict. (We deliberately don't key on `=======`, which appears in
// legitimate file content far more often than the angle-bracket markers.)
const CONFLICT_MARKER_RE = /^(?:<{7}|>{7})/m;

function containsConflictMarkers(content: string): boolean {
  return CONFLICT_MARKER_RE.test(content);
}

function truncateDetail(detail: string): string {
  const trimmed = detail.trim();
  return trimmed.length > FAILURE_SUMMARY_MAX
    ? `${trimmed.slice(0, FAILURE_SUMMARY_MAX)}…`
    : trimmed;
}

type MergeAndResolveOutcome =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "fast-forward" }
  | { readonly kind: "merged-clean" }
  | { readonly kind: "merged-resolved"; readonly commitSha: string; readonly files: ReadonlyArray<string> }
  | { readonly kind: "unresolved"; readonly files: ReadonlyArray<string> };

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const gitCore = yield* GitVcsDriver;
  const textGeneration = yield* TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const appendActivity = (input: {
    readonly threadId: ThreadId;
    readonly tone: "info" | "error";
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId(input.kind),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const appendSyncFailure = (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    appendActivity({
      threadId: input.threadId,
      tone: "error",
      kind: "sync.failed",
      summary: `Sync failed: ${truncateDetail(input.detail)}`,
      payload: { detail: input.detail },
      createdAt: input.createdAt,
    }).pipe(Effect.catch(() => Effect.void));

  const resolveThreadDetail = Effect.fn("resolveThreadDetail")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const resolveSessionCwd = Effect.fn("resolveSessionCwd")(function* (threadId: ThreadId) {
    const sessions = yield* providerService.listSessions();
    const session = sessions.find((entry) => entry.threadId === threadId);
    return session?.cwd ? Option.some(session.cwd) : Option.none<string>();
  });

  const resolveThreadProjects = Effect.fn("resolveThreadProjects")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    return project ? [project] : [];
  });

  // Resolve the workspace cwd, preferring an active provider session but falling
  // back to the thread's worktree / project workspace root so sync works on idle
  // threads whose session has been reaped.
  const resolveSyncCwd = Effect.fn("resolveSyncCwd")(function* (thread: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) {
    const fromSession = yield* resolveSessionCwd(thread.id);
    if (Option.isSome(fromSession)) {
      return fromSession;
    }
    const projects = yield* resolveThreadProjects(thread.projectId);
    const fromThread = resolveThreadWorkspaceCwd({
      thread: { projectId: thread.projectId, worktreePath: thread.worktreePath },
      projects,
    });
    return fromThread ? Option.some(fromThread) : Option.none<string>();
  });

  const refreshWorkspace = (cwd: string) =>
    Effect.all(
      [
        workspaceEntries.refresh(cwd),
        vcsStatusBroadcaster.refreshLocalStatus(cwd).pipe(Effect.catch(() => Effect.void)),
      ],
      { discard: true },
    );

  // Read-only preparation: resolve the remote + its default branch and fetch it.
  // Failures here happen before any mutation, so no recovery is needed. Git
  // errors are caught by the caller and turned into a failed-precondition.
  const prepareMerge = Effect.fn("prepareMerge")(function* (input: {
    readonly cwd: string;
    readonly remoteName: string | null;
    readonly targetBranch: string | null;
  }) {
    const details = yield* gitCore.statusDetails(input.cwd);
    if (!details.isRepo) {
      return { ok: false as const, detail: "This workspace is not a git repository." };
    }
    const branch = details.branch;
    if (!branch) {
      return { ok: false as const, detail: "Cannot sync from a detached HEAD." };
    }
    const remote = input.remoteName ?? (yield* gitCore.resolvePrimaryRemoteName(input.cwd));
    // Prefer the branch the user picked; fall back to the remote's default branch.
    const mainBranch =
      input.targetBranch ??
      (yield* gitCore.resolveRemoteDefaultBranch({ cwd: input.cwd, remoteName: remote }));
    if (!mainBranch) {
      return {
        ok: false as const,
        detail: `Could not determine the default branch for remote '${remote}'.`,
      };
    }
    yield* gitCore.fetchRemoteTrackingBranch({
      cwd: input.cwd,
      remoteName: remote,
      remoteBranch: mainBranch,
    });
    return { ok: true as const, remote, mainBranch, branch, targetRef: `${remote}/${mainBranch}` };
  });

  const runMergeAndResolve = Effect.fn("runMergeAndResolve")(function* (input: {
    readonly cwd: string;
    readonly targetRef: string;
    readonly modelSelection: ModelSelection;
  }) {
    const mergeResult = yield* gitCore.merge({ cwd: input.cwd, ref: input.targetRef });
    if (mergeResult.outcome === "up-to-date") {
      return { kind: "up-to-date" as const };
    }
    if (mergeResult.outcome === "fast-forward") {
      return { kind: "fast-forward" as const };
    }
    if (mergeResult.outcome === "merged") {
      return { kind: "merged-clean" as const };
    }

    // conflict: resolve each file with a single-shot LLM call.
    const unresolved: string[] = [];
    const resolved: string[] = [];
    for (const file of mergeResult.conflictedFiles) {
      const absolutePath = path.join(input.cwd, file);
      const content = yield* fileSystem
        .readFileString(absolutePath)
        .pipe(Effect.orElseSucceed(() => null));
      // Skip files we can't safely resolve: unreadable, too large to send
      // without truncation, or binary (contains a NUL byte).
      if (content === null || content.length > MAX_CONFLICT_FILE_CHARS || content.includes(NUL_BYTE)) {
        unresolved.push(file);
        continue;
      }
      const resolvedContent = yield* textGeneration
        .resolveMergeConflict({
          cwd: input.cwd,
          path: file,
          conflictedContent: content,
          modelSelection: input.modelSelection,
        })
        .pipe(
          Effect.map((result) => result.resolvedContent),
          Effect.orElseSucceed(() => null),
        );
      if (resolvedContent === null || containsConflictMarkers(resolvedContent)) {
        unresolved.push(file);
        continue;
      }
      // Independent correctness gate: a fresh model call reviews whether the
      // resolution faithfully combines both sides without dropping/corrupting
      // code. Fail closed — a failed or errored review leaves the file
      // unresolved, which rolls back the whole merge.
      const verdict = yield* textGeneration
        .verifyMergeResolution({
          cwd: input.cwd,
          path: file,
          conflictedContent: content,
          resolvedContent,
          modelSelection: input.modelSelection,
        })
        .pipe(Effect.orElseSucceed(() => ({ ok: false, reason: "verification call failed" })));
      if (!verdict.ok) {
        yield* Effect.logWarning("sync merge resolution rejected by verification", {
          file,
          reason: verdict.reason,
        });
        unresolved.push(file);
        continue;
      }
      yield* fileSystem.writeFileString(absolutePath, resolvedContent);
      resolved.push(file);
    }

    if (unresolved.length > 0) {
      return { kind: "unresolved" as const, files: unresolved };
    }

    const { commitSha } = yield* gitCore.finalizeMergeCommit({
      cwd: input.cwd,
      message: `Merge ${input.targetRef} (sync with remote)`,
    });
    return { kind: "merged-resolved" as const, commitSha, files: resolved };
  });

  // Reapply the stashed WIP. A conflict here is left as uncommitted markers in
  // the working tree (never folded into the merge commit) and the stash is kept
  // for recovery.
  const reapplyStash = Effect.fn("reapplyStash")(function* (cwd: string) {
    const apply = yield* gitCore.stashApply({ cwd, ref: STASH_REF });
    if (apply.conflicted) {
      return { conflicted: true };
    }
    yield* gitCore.stashDrop({ cwd, ref: STASH_REF }).pipe(Effect.catch(() => Effect.void));
    return { conflicted: false };
  });

  const successSummary = (input: {
    readonly outcome: Exclude<MergeAndResolveOutcome, { kind: "unresolved" }>;
    readonly targetRef: string;
    readonly model: string;
  }): string => {
    switch (input.outcome.kind) {
      case "up-to-date":
        return `Already up to date with ${input.targetRef}`;
      case "fast-forward":
        return `Synced with ${input.targetRef} (fast-forward)`;
      case "merged-clean":
        return `Merged ${input.targetRef}`;
      case "merged-resolved": {
        const count = input.outcome.files.length;
        return `Merged ${input.targetRef}, resolved ${count} conflict${
          count === 1 ? "" : "s"
        } with ${input.model}`;
      }
    }
  };

  const handleSyncRequested = Effect.fn("handleSyncRequested")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.sync-requested" }>,
  ) {
    const now = yield* nowIso;
    const threadId = event.payload.threadId;

    const thread = yield* resolveThreadDetail(threadId);
    if (!thread) {
      yield* appendSyncFailure({
        threadId,
        detail: "Thread was not found in the read model.",
        createdAt: now,
      });
      return;
    }

    const cwdOption = yield* resolveSyncCwd(thread);
    if (Option.isNone(cwdOption)) {
      yield* appendSyncFailure({
        threadId,
        detail: "Could not determine a workspace directory for this thread.",
        createdAt: now,
      });
      return;
    }
    const cwd = cwdOption.value;
    if (!isGitRepository(cwd)) {
      yield* appendSyncFailure({
        threadId,
        detail: "Sync is unavailable because this project is not a git repository.",
        createdAt: now,
      });
      return;
    }

    const prep = yield* prepareMerge({
      cwd,
      remoteName: event.payload.remoteName,
      targetBranch: event.payload.branch,
    }).pipe(
      Effect.catchTag("GitCommandError", (error) =>
        Effect.succeed({ ok: false as const, detail: error.message }),
      ),
    );
    if (!prep.ok) {
      yield* appendSyncFailure({ threadId, detail: prep.detail, createdAt: now });
      return;
    }
    const targetRef = prep.targetRef;
    const model = thread.modelSelection.model;

    // From here we mutate the working tree: stash, then merge.
    const stashed = (
      yield* gitCore.stashPushIncludingUntracked({ cwd, message: STASH_MESSAGE })
    ).stashed;

    const outcome = yield* runMergeAndResolve({
      cwd,
      targetRef,
      modelSelection: thread.modelSelection,
    }).pipe(
      Effect.catch((error) => Effect.succeed({ kind: "error" as const, detail: error.message })),
    );

    if (outcome.kind === "error" || outcome.kind === "unresolved") {
      // Recover: undo the in-progress merge, then restore the user's WIP.
      yield* gitCore.mergeAbort(cwd).pipe(Effect.catch(() => Effect.void));
      if (stashed) {
        yield* reapplyStash(cwd).pipe(Effect.catch(() => Effect.void));
      }
      yield* refreshWorkspace(cwd);
      const detail =
        outcome.kind === "unresolved"
          ? `Could not resolve ${outcome.files.length} conflicted file${
              outcome.files.length === 1 ? "" : "s"
            } (${outcome.files.join(", ")}). The merge was rolled back.`
          : outcome.detail;
      yield* appendSyncFailure({ threadId, detail, createdAt: now });
      return;
    }

    // Success: reapply the stashed WIP on top of the merged tree.
    let wipReapplyConflict = false;
    if (stashed) {
      const reapply = yield* reapplyStash(cwd).pipe(
        Effect.orElseSucceed(() => ({ conflicted: false })),
      );
      wipReapplyConflict = reapply.conflicted;
    }

    yield* refreshWorkspace(cwd);

    yield* appendActivity({
      threadId,
      tone: "info",
      kind: "sync.completed",
      summary: successSummary({ outcome, targetRef, model }),
      payload: {
        outcome: outcome.kind,
        targetRef,
        ...(outcome.kind === "merged-resolved"
          ? { commitSha: outcome.commitSha, resolvedFiles: outcome.files }
          : {}),
        wipReapplyConflict,
      },
      createdAt: now,
    }).pipe(Effect.catch(() => Effect.void));

    if (wipReapplyConflict) {
      yield* appendActivity({
        threadId,
        tone: "error",
        kind: "sync.wip-conflict",
        summary:
          "Your uncommitted changes hit conflicts when reapplied — resolve them in the working tree. They're also saved in the stash.",
        payload: { stashRef: STASH_REF },
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
    }
  });

  const processInputSafely = (
    event: Extract<OrchestrationEvent, { type: "thread.sync-requested" }>,
  ) =>
    handleSyncRequested(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("sync reactor failed to process input", {
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: SyncReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.sync-requested" ? worker.enqueue(event) : Effect.void,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies SyncReactorShape;
});

export const SyncReactorLive = Layer.effect(SyncReactor, make);
