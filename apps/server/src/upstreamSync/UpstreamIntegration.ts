import * as NodeCrypto from "node:crypto";

import {
  type ProjectId,
  type ThreadId,
  UpstreamAbortError,
  UpstreamCheckError,
  type UpstreamCheckReason,
  UpstreamPrepareError,
  type UpstreamSyncSession,
  type UpstreamTarget,
  type UpstreamUpdateState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  GitUpstreamAdapter,
  GitUpstreamAdapterError,
  UPSTREAM_BASE_REF,
} from "./GitUpstreamAdapter.ts";
import {
  compareNightlyTags,
  countNightliesAfter,
  newestNightlyTag,
  parseNightlyTag,
  type NightlyTagRef,
} from "./NightlyTag.ts";
import {
  type PersistedUpstreamSyncDocument,
  UpstreamSyncPersistence,
} from "./UpstreamSyncPersistence.ts";

export interface UpstreamIntegrationService {
  readonly getState: Effect.Effect<UpstreamUpdateState>;
  readonly streamChanges: Stream.Stream<UpstreamUpdateState>;
  readonly check: (
    reason: UpstreamCheckReason,
  ) => Effect.Effect<UpstreamUpdateState, UpstreamCheckError>;
  readonly dismiss: (target: UpstreamTarget) => Effect.Effect<UpstreamUpdateState>;
  readonly prepare: (
    target: UpstreamTarget,
  ) => Effect.Effect<UpstreamSyncSession, UpstreamPrepareError>;
  readonly abort: (sessionId: string) => Effect.Effect<void, UpstreamAbortError>;
  readonly attachThread: (
    sessionId: string,
    threadId: ThreadId,
  ) => Effect.Effect<UpstreamSyncSession, UpstreamPrepareError>;
}

export class UpstreamIntegration extends Context.Service<
  UpstreamIntegration,
  UpstreamIntegrationService
>()("t3/upstreamSync/UpstreamIntegration") {}

const toCheckError = (error: GitUpstreamAdapterError): UpstreamCheckError =>
  new UpstreamCheckError({
    operation: error.operation,
    message: error.message,
    canRetry: error.canRetry,
  });

const toPrepareError = (error: GitUpstreamAdapterError): UpstreamPrepareError =>
  new UpstreamPrepareError({
    operation: error.operation,
    message: error.message,
    canRetry: error.canRetry,
  });

const gitError = (operation: string, message: string, canRetry = false) =>
  new GitUpstreamAdapterError({ operation, message, canRetry });

const persistIgnoringFailure = (
  persistence: UpstreamSyncPersistence["Service"],
  document: PersistedUpstreamSyncDocument,
) =>
  persistence
    .save(document)
    .pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not persist upstream synchronization state.").pipe(
          Effect.annotateLogs({ cause }),
        ),
      ),
    );

function syncNames(tag: string, sourcePath: string, path: Path.Path) {
  const parsed = parseNightlyTag(tag);
  if (!parsed) throw new Error("Invalid nightly tag.");
  const shortName = `t3-nightly-${parsed.date}-${parsed.build}`;
  const preferredBranch = `sync/t3-${tag}`;
  const branch = preferredBranch.length <= 120 ? preferredBranch : `sync/${shortName}`;
  return {
    branch,
    worktreePath: path.resolve(sourcePath, "..", "t3code-worktrees", `sync-${shortName}`),
  };
}

export const make = Effect.gen(function* () {
  const git = yield* GitUpstreamAdapter;
  const persistence = yield* UpstreamSyncPersistence;
  const settings = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const initialDocument = yield* persistence.load;
  const documentRef = yield* Ref.make(initialDocument);
  const initialState: UpstreamUpdateState = initialDocument.activeSession
    ? {
        status: "session-active",
        session: initialDocument.activeSession,
        newerTarget: null,
      }
    : initialDocument.state;
  const stateRef = yield* SubscriptionRef.make(initialState);

  const publishDocument = Effect.fn("UpstreamIntegration.publishDocument")(function* (
    document: PersistedUpstreamSyncDocument,
  ) {
    yield* Ref.set(documentRef, document);
    yield* SubscriptionRef.set(stateRef, document.state);
    yield* persistIgnoringFailure(persistence, document);
    return document.state;
  });

  const sourceProject = Effect.fn("UpstreamIntegration.sourceProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projects
      .getProjectShellById(projectId)
      .pipe(
        Effect.mapError(() =>
          gitError("resolve-source-project", "Could not read the configured DX source project."),
        ),
      );
    if (Option.isNone(project)) {
      return yield* gitError(
        "resolve-source-project",
        "The configured DX source project no longer exists.",
      );
    }
    return project.value;
  });

  const validateGroupedNightlies = Effect.fn("UpstreamIntegration.validateGroupedNightlies")(
    function* (input: {
      readonly cwd: string;
      readonly refs: ReadonlyArray<NightlyTagRef>;
      readonly newest: NightlyTagRef;
      readonly newestCommit: string;
      readonly dismissedTarget: UpstreamTarget | null;
    }) {
      const dismissedParsed = input.dismissedTarget
        ? parseNightlyTag(input.dismissedTarget.tag)
        : null;
      if (!dismissedParsed || !input.dismissedTarget) return;
      const candidates = input.refs.filter(
        (ref) =>
          compareNightlyTags(ref.parsed, dismissedParsed) > 0 &&
          compareNightlyTags(ref.parsed, input.newest.parsed) < 0,
      );
      const dismissedIsAncestor = yield* git.isAncestor(
        input.cwd,
        input.dismissedTarget.commit,
        input.newestCommit,
      );
      if (!dismissedIsAncestor) {
        return yield* gitError(
          "validate-nightly-history",
          "The newest nightly does not contain the previously dismissed nightly.",
        );
      }
      for (const candidate of candidates) {
        const commit = yield* git.fetchNightly(input.cwd, candidate);
        if (!(yield* git.isAncestor(input.cwd, commit, input.newestCommit))) {
          return yield* gitError(
            "validate-nightly-history",
            `Nightly history is non-linear at ${candidate.tag}.`,
          );
        }
      }
    },
  );

  const checkUnlocked = Effect.fn("UpstreamIntegration.checkUnlocked")(function* (
    reason: UpstreamCheckReason,
  ) {
    const currentDocument = yield* Ref.get(documentRef);
    const serverSettings = yield* settings.getSettings.pipe(
      Effect.mapError(() =>
        gitError("read-settings", "Could not read upstream synchronization settings.", true),
      ),
    );
    const syncSettings = serverSettings.upstreamSync;
    if (syncSettings.sourceProjectId === null) {
      return yield* publishDocument({
        ...currentDocument,
        cursor: {
          ...currentDocument.cursor,
          policy: syncSettings.policy,
          paused: syncSettings.paused,
        },
        state: { status: "disabled", reason: "Choose a DX source checkout in Settings." },
      });
    }
    if (syncSettings.paused && reason !== "manual") {
      return yield* publishDocument({
        ...currentDocument,
        cursor: { ...currentDocument.cursor, paused: true },
        state: { status: "paused" },
      });
    }
    if (syncSettings.policy === "manual" && reason !== "manual") {
      return yield* publishDocument({
        ...currentDocument,
        state: {
          status: "disabled",
          reason: "Scheduled checks are disabled. Manual nightly checks remain available.",
        },
      });
    }
    if (syncSettings.policy === "stable-tags" || syncSettings.policy === "upstream-main") {
      return yield* publishDocument({
        ...currentDocument,
        state: { status: "disabled", reason: "This upstream policy is not available yet." },
      });
    }

    const project = yield* sourceProject(syncSettings.sourceProjectId);
    yield* git.validateRepository(project.workspaceRoot);
    const refs = yield* git.listNightlies(project.workspaceRoot);
    const newest = newestNightlyTag(refs);
    if (!newest) {
      return yield* gitError("list-nightlies", "No valid upstream nightly tags were found.", true);
    }
    const commit = yield* git.fetchNightly(project.workspaceRoot, newest);
    yield* git.recheckRemoteObject(project.workspaceRoot, newest);
    const target: UpstreamTarget = {
      policy: "nightly-tags",
      tag: newest.tag,
      commit,
      remote: "upstream",
    };
    yield* validateGroupedNightlies({
      cwd: project.workspaceRoot,
      refs,
      newest,
      newestCommit: commit,
      dismissedTarget: currentDocument.cursor.dismissedTarget,
    });

    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const remoteTagObjects = {
      ...currentDocument.remoteTagObjects,
      [target.tag]: newest.remoteObject,
    };
    const integrated = yield* git.isAncestor(project.workspaceRoot, commit, UPSTREAM_BASE_REF);
    if (integrated) {
      return yield* publishDocument({
        ...currentDocument,
        remoteTagObjects,
        cursor: {
          ...currentDocument.cursor,
          policy: syncSettings.policy,
          paused: syncSettings.paused,
        },
        state: {
          status: "up-to-date",
          integratedTag: target.tag,
          integratedCommit: commit,
          checkedAt,
        },
      });
    }

    if (currentDocument.activeSession) {
      const activeTarget = currentDocument.activeSession.target;
      return yield* publishDocument({
        ...currentDocument,
        remoteTagObjects,
        state: {
          status: "session-active",
          session: currentDocument.activeSession,
          newerTarget:
            activeTarget.tag === target.tag && activeTarget.commit === target.commit
              ? null
              : target,
        },
      });
    }

    const dismissed = currentDocument.cursor.dismissedTarget;
    if (dismissed?.tag === target.tag && dismissed.commit === target.commit) {
      return yield* publishDocument({
        ...currentDocument,
        remoteTagObjects,
        state: { status: "dismissed", target, checkedAt },
      });
    }

    const commitCount = yield* git.countCommits(project.workspaceRoot, commit);
    return yield* publishDocument({
      ...currentDocument,
      remoteTagObjects,
      cursor: {
        ...currentDocument.cursor,
        policy: syncSettings.policy,
        paused: syncSettings.paused,
      },
      state: {
        status: "available",
        target,
        commitCount,
        newerNightlyCount: countNightliesAfter(refs, dismissed?.tag ?? null, target.tag),
        previousDismissedTag: dismissed?.tag ?? null,
        release: null,
        checkedAt,
      },
    });
  });

  const check = (reason: UpstreamCheckReason) =>
    lock
      .withPermits(1)(checkUnlocked(reason))
      .pipe(
        Effect.mapError(toCheckError),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const document = yield* Ref.get(documentRef);
            if (reason !== "manual") {
              yield* Effect.logWarning(
                "Scheduled upstream check failed; retaining previous state.",
                {
                  operation: error.operation,
                  message: error.message,
                },
              );
              return;
            }
            const state: UpstreamUpdateState = {
              status: "error",
              message: error.message,
              canRetry: error.canRetry,
              checkedAt: "checkedAt" in document.state ? (document.state.checkedAt ?? null) : null,
            };
            yield* publishDocument({ ...document, state });
          }),
        ),
      );

  const dismiss = Effect.fn("UpstreamIntegration.dismiss")(function* (target: UpstreamTarget) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const document = yield* Ref.get(documentRef);
        const state: UpstreamUpdateState =
          document.state.status === "available" &&
          document.state.target.tag === target.tag &&
          document.state.target.commit === target.commit
            ? {
                status: "dismissed",
                target,
                checkedAt: document.state.checkedAt,
              }
            : document.state;
        return yield* publishDocument({
          ...document,
          cursor: { ...document.cursor, dismissedTarget: target },
          state,
        });
      }),
    );
  });

  const prepareUnlocked = Effect.fn("UpstreamIntegration.prepareUnlocked")(function* (
    target: UpstreamTarget,
  ) {
    const document = yield* Ref.get(documentRef);
    if (document.activeSession) {
      if (
        document.activeSession.target.tag === target.tag &&
        document.activeSession.target.commit === target.commit
      ) {
        return document.activeSession;
      }
      return yield* gitError(
        "prepare-session",
        `A synchronization session for ${document.activeSession.target.tag} is already active.`,
      );
    }
    const serverSettings = yield* settings.getSettings.pipe(
      Effect.mapError(() => gitError("read-settings", "Could not read sync settings.")),
    );
    const projectId = serverSettings.upstreamSync.sourceProjectId;
    if (projectId === null) {
      return yield* gitError(
        "prepare-session",
        "Choose a DX source checkout before preparing a synchronization.",
      );
    }
    const project = yield* sourceProject(projectId);
    yield* git.validateRepository(project.workspaceRoot);
    const remoteRefs = yield* git.listNightlies(project.workspaceRoot, target.tag);
    const remoteRef = remoteRefs[0];
    const detectedRemoteObject = document.remoteTagObjects[target.tag];
    if (
      remoteRefs.length !== 1 ||
      !remoteRef ||
      detectedRemoteObject === undefined ||
      remoteRef.remoteObject !== detectedRemoteObject
    ) {
      return yield* gitError(
        "prepare-session",
        "The upstream nightly tag changed after detection. Review the remote before continuing.",
      );
    }
    const resolvedCommit = yield* git.fetchNightly(project.workspaceRoot, remoteRef);
    if (resolvedCommit !== target.commit) {
      return yield* gitError(
        "prepare-session",
        "The pinned nightly commit no longer matches the fetched tag.",
      );
    }
    yield* git.recheckRemoteObject(project.workspaceRoot, remoteRef);

    const names = syncNames(target.tag, project.workspaceRoot, path);
    if (yield* fs.exists(names.worktreePath)) {
      return yield* gitError(
        "prepare-session",
        `Sync worktree path already exists: ${names.worktreePath}.`,
      );
    }
    const comparison = yield* git.comparisonReport(project.workspaceRoot, target.commit);
    const commitCount = yield* git.countCommits(project.workspaceRoot, target.commit);
    const merge = yield* git.prepareMerge({
      cwd: project.workspaceRoot,
      branch: names.branch,
      worktreePath: names.worktreePath,
      targetCommit: target.commit,
    });
    const session: UpstreamSyncSession = {
      id: NodeCrypto.randomUUID(),
      sourceProjectId: projectId,
      target,
      commitCount,
      newerNightlyCount:
        document.state.status === "available" &&
        document.state.target.tag === target.tag &&
        document.state.target.commit === target.commit
          ? document.state.newerNightlyCount
          : 0,
      metricsHydrated: true,
      remoteTagObject: remoteRef.remoteObject,
      branch: names.branch,
      worktreePath: names.worktreePath,
      status: merge.status,
      conflictFiles: merge.conflicts,
      comparison: {
        baseCommit: comparison.baseCommit,
        upstreamFileCount: comparison.upstreamFiles.length,
        dxFileCount: comparison.dxFiles.length,
        overlappingFiles: comparison.overlappingFiles,
      },
      threadId: null,
      createdAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* publishDocument({
      ...document,
      cursor: { ...document.cursor, activeSessionId: session.id },
      activeSession: session,
      state: { status: "session-active", session, newerTarget: null },
    });
    return session;
  });

  const prepare = (target: UpstreamTarget) =>
    lock
      .withPermits(1)(prepareUnlocked(target))
      .pipe(
        Effect.mapError((error) =>
          error instanceof GitUpstreamAdapterError
            ? toPrepareError(error)
            : new UpstreamPrepareError({
                operation: "prepare-session",
                message: "Could not inspect the synchronization worktree path.",
                canRetry: true,
              }),
        ),
      );

  const attachThread = (sessionId: string, threadId: ThreadId) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const document = yield* Ref.get(documentRef);
        const session = document.activeSession;
        if (!session || session.id !== sessionId) {
          return yield* new UpstreamPrepareError({
            operation: "attach-thread",
            message: "The synchronization session is no longer active.",
            canRetry: false,
          });
        }
        const nextSession = { ...session, threadId };
        yield* publishDocument({
          ...document,
          activeSession: nextSession,
          state: { status: "session-active", session: nextSession, newerTarget: null },
        });
        return nextSession;
      }),
    );

  const abort = (sessionId: string) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const document = yield* Ref.get(documentRef);
        const session = document.activeSession;
        if (!session || session.id !== sessionId) {
          return yield* new UpstreamAbortError({
            operation: "abort-session",
            message: "The synchronization session is no longer active.",
            canRetry: false,
          });
        }
        yield* git.abortMerge(session.worktreePath).pipe(
          Effect.mapError(
            (error) =>
              new UpstreamAbortError({
                operation: error.operation,
                message: error.message,
                canRetry: error.canRetry,
              }),
          ),
        );
        yield* publishDocument({
          ...document,
          cursor: { ...document.cursor, activeSessionId: null },
          activeSession: null,
          state: { status: "disabled", reason: "Run a check for the latest nightly." },
        });
      }),
    );

  if (initialDocument.activeSession && !initialDocument.activeSession.metricsHydrated) {
    yield* Effect.gen(function* () {
      const document = yield* Ref.get(documentRef);
      const session = document.activeSession;
      if (!session || session.metricsHydrated) return;
      const project = yield* sourceProject(session.sourceProjectId);
      const commitCount = yield* git.countCommits(project.workspaceRoot, session.target.commit);
      const refs = document.cursor.dismissedTarget
        ? yield* git.listNightlies(project.workspaceRoot)
        : [];
      const nextSession: UpstreamSyncSession = {
        ...session,
        commitCount,
        newerNightlyCount: countNightliesAfter(
          refs,
          document.cursor.dismissedTarget?.tag ?? null,
          session.target.tag,
        ),
        metricsHydrated: true,
      };
      yield* publishDocument({
        ...document,
        activeSession: nextSession,
        state: { status: "session-active", session: nextSession, newerTarget: null },
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not recover legacy synchronization metrics.").pipe(
          Effect.annotateLogs({ cause }),
        ),
      ),
    );
  }

  if (initialDocument.activeSession) {
    const document = yield* Ref.get(documentRef);
    const activeSession = document.activeSession;
    if (activeSession) {
      const exists = yield* fs
        .exists(activeSession.worktreePath)
        .pipe(Effect.orElseSucceed(() => false));
      if (!exists && activeSession.status !== "recoverable") {
        const session = { ...activeSession, status: "recoverable" as const };
        yield* publishDocument({
          ...document,
          activeSession: session,
          state: { status: "session-active", session, newerTarget: null },
        });
      }
    }
  }

  return UpstreamIntegration.of({
    getState: SubscriptionRef.get(stateRef),
    streamChanges: SubscriptionRef.changes(stateRef),
    check,
    dismiss,
    prepare,
    abort,
    attachThread,
  });
});

export const layer = Layer.effect(UpstreamIntegration, make);
