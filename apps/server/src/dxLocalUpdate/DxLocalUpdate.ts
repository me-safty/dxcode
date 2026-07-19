import * as NodeCrypto from "node:crypto";

import {
  DxPublishError,
  type DxArtifactManifest,
  DxUpdateCheckError,
  type DxUpdateCheckReason,
  type DxLocalUpdateState,
  type DxUpdatePlan,
  DxUpdatePrepareError,
  type DxUpdateReason,
  type UpstreamSyncSession,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import { UpstreamIntegration } from "../upstreamSync/UpstreamIntegration.ts";
import { type PersistedDxUpdateDocument, DxUpdatePersistence } from "./DxUpdatePersistence.ts";
import { GitDxReleaseAdapter, GitDxReleaseAdapterError } from "./GitDxReleaseAdapter.ts";
import { DxBuildAdapter } from "./DxBuildAdapter.ts";

export interface DxLocalUpdateService {
  readonly getState: Effect.Effect<DxLocalUpdateState>;
  readonly streamChanges: Stream.Stream<DxLocalUpdateState>;
  readonly check: (
    reason: DxUpdateCheckReason,
  ) => Effect.Effect<DxLocalUpdateState, DxUpdateCheckError>;
  readonly prepare: Effect.Effect<DxUpdatePlan, DxUpdatePrepareError>;
  readonly publishAndBuild: (planId: string) => Effect.Effect<DxArtifactManifest, DxPublishError>;
  readonly attachReviewSession: (session: UpstreamSyncSession) => Effect.Effect<void>;
}

export class DxLocalUpdate extends Context.Service<DxLocalUpdate, DxLocalUpdateService>()(
  "t3/dxLocalUpdate/DxLocalUpdate",
) {}

const checkError = (error: GitDxReleaseAdapterError) =>
  new DxUpdateCheckError({
    operation: error.operation,
    message: error.message,
    canRetry: error.canRetry,
  });

const prepareError = (error: GitDxReleaseAdapterError) =>
  new DxUpdatePrepareError({
    operation: error.operation,
    message: error.message,
    canRetry: error.canRetry,
  });

const gitError = (operation: string, message: string, canRetry = false) =>
  new GitDxReleaseAdapterError({ operation, message, canRetry });

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const git = yield* GitDxReleaseAdapter;
  const build = yield* DxBuildAdapter;
  const upstream = yield* UpstreamIntegration;
  const persistence = yield* DxUpdatePersistence;
  const settings = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const initialDocument = yield* persistence.load;
  const documentRef = yield* Ref.make(initialDocument);
  const stateRef = yield* SubscriptionRef.make(initialDocument.state);
  const lock = yield* Semaphore.make(1);

  const publishDocument = Effect.fn("DxLocalUpdate.publishDocument")(function* (
    document: PersistedDxUpdateDocument,
  ) {
    yield* Ref.set(documentRef, document);
    yield* SubscriptionRef.set(stateRef, document.state);
    yield* persistence
      .save(document)
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not persist local DX update state.").pipe(
            Effect.annotateLogs({ cause }),
          ),
        ),
      );
    return document.state;
  });

  const sourceProject = Effect.fn("DxLocalUpdate.sourceProject")(function* () {
    const currentSettings = yield* settings.getSettings.pipe(
      Effect.mapError(() => gitError("read-settings", "Could not read DX update settings.", true)),
    );
    const projectId = currentSettings.upstreamSync.sourceProjectId;
    if (projectId === null) {
      return yield* gitError("resolve-source-project", "Choose a DX source checkout in Settings.");
    }
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
    return { projectId, project: project.value, settings: currentSettings.upstreamSync };
  });

  const checkUnlocked = Effect.fn("DxLocalUpdate.checkUnlocked")(function* (
    reason: DxUpdateCheckReason,
  ) {
    const document = yield* Ref.get(documentRef);
    if (
      config.desktopFlavor !== "dx" ||
      config.localDxUpdateCapable !== true ||
      config.installedSourceCommit === undefined
    ) {
      return yield* publishDocument({
        ...document,
        state: {
          status: "disabled",
          reason:
            config.desktopFlavor === "dx" && config.installedSourceCommit === undefined
              ? "This DX build has no trusted source provenance. Rebuild it manually."
              : "Local DX updates require a packaged DX Code build.",
        },
      });
    }

    const source = yield* sourceProject();
    if (source.settings.paused && reason !== "manual") {
      return document.state;
    }
    yield* git.validateRepository(source.project.workspaceRoot);
    const remoteCommit = yield* git.remoteHead(source.project.workspaceRoot);
    yield* git.fetchRemoteHead(source.project.workspaceRoot, remoteCommit);
    const classification = yield* git.classifyInstalled({
      cwd: source.project.workspaceRoot,
      installedCommit: config.installedSourceCommit,
      remoteCommit,
    });
    if (classification.status === "unknown-installed") {
      return yield* publishDocument({
        ...document,
        state: {
          status: "error",
          message: "The installed DX source commit is unavailable locally. Rebuild manually.",
          canRetry: false,
        },
      });
    }
    if (classification.status === "diverged") {
      return yield* publishDocument({
        ...document,
        state: {
          status: "error",
          message: "Installed DX Code and origin/dx/main have diverged. Review history manually.",
          canRetry: false,
        },
      });
    }
    if (classification.status === "installed-ahead") {
      return yield* publishDocument({
        ...document,
        state: {
          status: "error",
          message: "Installed DX Code is ahead of origin/dx/main. Automatic downgrade is blocked.",
          canRetry: false,
        },
      });
    }

    const upstreamState = yield* upstream
      .check(reason)
      .pipe(Effect.mapError((error) => gitError(error.operation, error.message, error.canRetry)));
    const reasons: Array<DxUpdateReason> = [];
    if (classification.status === "remote-ahead") {
      reasons.push({
        kind: "origin-dx-main",
        installedCommit: config.installedSourceCommit,
        remoteCommit,
        commitsBehind: classification.commitsBehind,
      });
    }
    if (upstreamState.status === "available") {
      reasons.push({ kind: "upstream-nightly", target: upstreamState.target });
    }
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return yield* publishDocument({
      ...document,
      state:
        reasons.length === 0
          ? { status: "up-to-date", sourceCommit: remoteCommit, checkedAt }
          : { status: "available", reasons, checkedAt },
    });
  });

  const check = (reason: DxUpdateCheckReason) =>
    lock
      .withPermits(1)(checkUnlocked(reason))
      .pipe(
        Effect.mapError(checkError),
        Effect.tapError((error) =>
          reason === "manual"
            ? Ref.get(documentRef).pipe(
                Effect.flatMap((document) =>
                  publishDocument({
                    ...document,
                    state: { status: "error", message: error.message, canRetry: error.canRetry },
                  }),
                ),
              )
            : Effect.logWarning(
                "Scheduled local DX update check failed; retaining previous state.",
                {
                  operation: error.operation,
                  message: error.message,
                },
              ),
        ),
      );

  const prepare = lock
    .withPermits(1)(
      Effect.gen(function* () {
        const document = yield* Ref.get(documentRef);
        if (document.plan !== null) return document.plan;
        if (document.state.status !== "available") {
          return yield* gitError("prepare-update", "No local DX update is available.");
        }
        const source = yield* sourceProject();
        yield* git.validateRepository(source.project.workspaceRoot);
        const remoteReason = document.state.reasons.find(
          (reason): reason is Extract<DxUpdateReason, { kind: "origin-dx-main" }> =>
            reason.kind === "origin-dx-main",
        );
        if (remoteReason) {
          const currentRemote = yield* git.remoteHead(source.project.workspaceRoot);
          if (currentRemote !== remoteReason.remoteCommit) {
            return yield* gitError(
              "prepare-update",
              "origin/dx/main moved after detection. Check again before continuing.",
              true,
            );
          }
          const isolatedRef = yield* git.fetchRemoteHead(
            source.project.workspaceRoot,
            currentRemote,
          );
          const mainWorktree = yield* git.findMainWorktree(source.project.workspaceRoot);
          const localMain = yield* git.requireCleanMain(mainWorktree);
          if (localMain !== currentRemote) {
            const localClassification = yield* git.classifyInstalled({
              cwd: source.project.workspaceRoot,
              installedCommit: localMain,
              remoteCommit: currentRemote,
            });
            if (localClassification.status !== "remote-ahead") {
              return yield* gitError(
                "prepare-update",
                "Local dx/main cannot fast-forward to the detected remote commit.",
              );
            }
            yield* git.fastForwardMain(mainWorktree, isolatedRef);
          }
        }

        const refreshedUpstream = yield* upstream
          .check("manual")
          .pipe(
            Effect.mapError((error) => gitError(error.operation, error.message, error.canRetry)),
          );
        const syncSession =
          refreshedUpstream.status === "available"
            ? yield* upstream
                .prepare(refreshedUpstream.target)
                .pipe(
                  Effect.mapError((error) =>
                    gitError(error.operation, error.message, error.canRetry),
                  ),
                )
            : null;
        const plan: DxUpdatePlan = {
          id: NodeCrypto.randomUUID(),
          sourceProjectId: source.projectId,
          installedCommit: config.installedSourceCommit ?? null,
          remoteCommitBeforePublish: yield* git.remoteHead(source.project.workspaceRoot),
          syncSessionId: syncSession?.id ?? null,
          reasons: document.state.reasons,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* publishDocument({
          ...document,
          plan,
          state: syncSession
            ? { status: "reviewing", session: syncSession }
            : { status: "awaiting-publish", sessionId: plan.id },
        });
        return plan;
      }),
    )
    .pipe(Effect.mapError(prepareError));

  const publishAndBuild = (planId: string) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          let document = yield* Ref.get(documentRef);
          const plan = document.plan;
          if (!plan || plan.id !== planId) {
            return yield* gitError("publish-update", "The DX update plan is no longer active.");
          }
          const source = yield* sourceProject();
          yield* git.validateRepository(source.project.workspaceRoot);
          const currentRemote = yield* git.remoteHead(source.project.workspaceRoot);
          if (currentRemote !== plan.remoteCommitBeforePublish) {
            return yield* gitError(
              "publish-update",
              "origin/dx/main moved after review. Refresh the sync branch and rerun checks.",
              true,
            );
          }
          const mainWorktree = yield* git.findMainWorktree(source.project.workspaceRoot);
          yield* git.requireCleanMain(mainWorktree);

          let sourceCommit = currentRemote;
          if (plan.syncSessionId !== null) {
            const upstreamState = yield* upstream.getState;
            if (
              upstreamState.status !== "session-active" ||
              upstreamState.session.id !== plan.syncSessionId
            ) {
              return yield* gitError(
                "publish-update",
                "The pinned upstream synchronization session is unavailable.",
              );
            }
            const session = upstreamState.session;
            document = {
              ...document,
              state: { status: "verifying", sessionId: session.id },
            };
            yield* publishDocument(document);
            yield* build
              .runRequiredChecks(session.worktreePath)
              .pipe(
                Effect.mapError((error) =>
                  gitError(error.operation, error.message, error.canRetry),
                ),
              );
            yield* publishDocument({
              ...document,
              state: { status: "publishing", phase: "committing-sync" },
            });
            sourceCommit = yield* git.commitPreparedSync({
              cwd: session.worktreePath,
              tag: session.target.tag,
              targetCommit: session.target.commit,
              nightlyCount: session.newerNightlyCount,
            });
            yield* publishDocument({
              ...document,
              state: { status: "publishing", phase: "pushing-sync" },
            });
            yield* git.pushSyncBranch(session.worktreePath, session.branch);
            const recheckedRemote = yield* git.remoteHead(source.project.workspaceRoot);
            if (recheckedRemote !== plan.remoteCommitBeforePublish) {
              return yield* gitError(
                "publish-update",
                "origin/dx/main moved during publication. The sync branch was preserved.",
                true,
              );
            }
            yield* publishDocument({
              ...document,
              state: { status: "publishing", phase: "fast-forwarding-main" },
            });
            yield* git.fastForwardMain(mainWorktree, sourceCommit);
            yield* publishDocument({
              ...document,
              state: { status: "publishing", phase: "pushing-main" },
            });
            yield* git.pushMain(mainWorktree);
          } else {
            yield* publishDocument({
              ...document,
              state: { status: "verifying", sessionId: plan.id },
            });
            yield* build
              .runRequiredChecks(mainWorktree)
              .pipe(
                Effect.mapError((error) =>
                  gitError(error.operation, error.message, error.canRetry),
                ),
              );
            sourceCommit = yield* git.localMainCommit(mainWorktree);
          }

          yield* publishDocument({
            ...document,
            state: { status: "publishing", phase: "verifying-identity" },
          });
          const [localPublished, remotePublished] = yield* Effect.all([
            git.localMainCommit(mainWorktree),
            git.remoteHead(source.project.workspaceRoot),
          ]);
          if (localPublished !== sourceCommit || remotePublished !== sourceCommit) {
            return yield* gitError(
              "verify-published-identity",
              "Local and remote dx/main do not match the planned commit.",
            );
          }
          yield* publishDocument({
            ...document,
            state: { status: "building", phase: "building" },
          });
          const artifact = yield* build
            .build(mainWorktree, sourceCommit)
            .pipe(
              Effect.mapError((error) => gitError(error.operation, error.message, error.canRetry)),
            );
          yield* publishDocument({
            ...document,
            session: {
              id: plan.id,
              sourceCommit,
              remoteCommitBeforePublish: plan.remoteCommitBeforePublish,
              syncSessionId: plan.syncSessionId,
              artifact,
              phase: "awaiting-install",
            },
            state: { status: "awaiting-install", artifact },
          });
          return artifact;
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          return new DxPublishError({
            operation: error.operation,
            message: error.message,
            canRetry: error.canRetry,
          });
        }),
      );

  const attachReviewSession = (session: UpstreamSyncSession) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const document = yield* Ref.get(documentRef);
        if (document.plan?.syncSessionId !== session.id) return;
        yield* publishDocument({
          ...document,
          state: { status: "reviewing", session },
        });
      }),
    );

  return DxLocalUpdate.of({
    getState: SubscriptionRef.get(stateRef),
    streamChanges: SubscriptionRef.changes(stateRef),
    check,
    prepare,
    publishAndBuild,
    attachReviewSession,
  });
});

export const layer = Layer.effect(DxLocalUpdate, make);
