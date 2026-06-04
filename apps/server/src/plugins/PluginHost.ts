import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type PluginId,
} from "@t3tools/contracts";
import type { LoadedServerPlugin } from "@t3tools/plugin-api/package";
import type { PluginActivationContext } from "@t3tools/plugin-api/server";
import {
  PluginRuntimeError,
  PluginStoreError as ApiPluginStoreError,
} from "@t3tools/plugin-api/server";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectSetupScriptRunner } from "../project/Services/ProjectSetupScriptRunner.ts";
import { getAutoBootstrapDefaultModelSelection } from "../serverRuntimeStartup.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { PluginPackageResolver } from "./PluginPackageResolver.ts";
import { PluginRegistry } from "./PluginRegistry.ts";
import { PluginStore } from "./PluginStore.ts";

export interface PluginHostShape {
  readonly activateInstalledPlugins: Effect.Effect<void>;
}

export class PluginHost extends Context.Service<PluginHost, PluginHostShape>()(
  "t3/plugins/PluginHost",
) {}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function toApiStoreError(error: unknown): ApiPluginStoreError {
  return error instanceof ApiPluginStoreError
    ? error
    : new ApiPluginStoreError("Plugin store operation failed.", error);
}

const makePluginRuntimeApi = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestration = yield* OrchestrationEngineService;
  const snapshot = yield* ProjectionSnapshotQuery;
  const settings = yield* ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner;

  const uuid = crypto.randomUUIDv4;
  const nextCommandId = (tag: string) =>
    uuid.pipe(
      Effect.mapError(
        (detail) => new PluginRuntimeError("Failed to generate plugin command id.", detail),
      ),
      Effect.map((id) => CommandId.make(`plugin:${tag}:${id}`)),
    );
  const nextThreadId = uuid.pipe(
    Effect.mapError(
      (detail) => new PluginRuntimeError("Failed to generate plugin thread id.", detail),
    ),
    Effect.map(ThreadId.make),
  );
  const nextMessageId = uuid.pipe(
    Effect.mapError(
      (detail) => new PluginRuntimeError("Failed to generate plugin message id.", detail),
    ),
    Effect.map((id) => MessageId.make(`plugin-msg-${id}`)),
  );

  return {
    createAndSendThread: (input) =>
      Effect.gen(function* () {
        const project = yield* snapshot.getProjectShellById(ProjectId.make(input.projectId)).pipe(
          Effect.map(Option.getOrNull),
          Effect.mapError(
            (detail) => new PluginRuntimeError("Failed to read target project.", detail),
          ),
        );
        if (project === null) {
          return yield* Effect.fail(
            new PluginRuntimeError(`Project ${input.projectId} was not found.`),
          );
        }

        const serverSettings = yield* settings.getSettings.pipe(
          Effect.mapError((detail) => new PluginRuntimeError("Failed to read settings.", detail)),
        );
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        const modelSelection =
          project.defaultModelSelection ?? getAutoBootstrapDefaultModelSelection();
        const threadId = yield* nextThreadId;
        let branch: string | null = null;
        let worktreePath: string | null = null;

        if (serverSettings.defaultThreadEnvMode === "worktree") {
          const localStatus = yield* gitWorkflow.localStatus({ cwd: project.workspaceRoot }).pipe(
            Effect.catch((detail) =>
              Effect.logWarning("Plugin thread launch could not inspect Git status", {
                projectId: project.id,
                cwd: project.workspaceRoot,
                detail,
              }).pipe(Effect.as(null)),
            ),
          );
          if (localStatus?.isRepo && localStatus.refName !== null) {
            const branchToken = (yield* uuid.pipe(
              Effect.mapError(
                (detail) =>
                  new PluginRuntimeError("Failed to generate automation branch token.", detail),
              ),
            )).replace(/-/g, "");
            const worktree = yield* gitWorkflow
              .createWorktree({
                cwd: project.workspaceRoot,
                refName: localStatus.refName,
                newRefName: buildTemporaryWorktreeBranchName(() => branchToken.slice(0, 8)),
                path: null,
              })
              .pipe(
                Effect.mapError(
                  (detail) =>
                    new PluginRuntimeError("Failed to create automation worktree.", detail),
                ),
              );
            branch = worktree.worktree.refName;
            worktreePath = worktree.worktree.path;
          }
        }

        let createdThread = false;
        const cleanupCreatedThread = () =>
          Effect.gen(function* () {
            if (!createdThread) {
              return;
            }
            yield* orchestration
              .dispatch({
                type: "thread.delete",
                commandId: yield* nextCommandId("thread-delete"),
                threadId,
              })
              .pipe(Effect.ignoreCause({ log: true }));
          });

        return yield* Effect.gen(function* () {
          yield* orchestration
            .dispatch({
              type: "thread.create",
              commandId: yield* nextCommandId("thread-create"),
              threadId,
              projectId: project.id,
              title: input.title,
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch,
              worktreePath,
              createdAt,
            })
            .pipe(
              Effect.mapError(
                (detail) => new PluginRuntimeError("Failed to create automation thread.", detail),
              ),
            );
          createdThread = true;

          if (worktreePath !== null) {
            yield* setupScripts
              .runForThread({
                threadId,
                projectId: project.id,
                projectCwd: project.workspaceRoot,
                worktreePath,
              })
              .pipe(
                Effect.catch((detail) =>
                  Effect.logWarning("Plugin thread launch could not start setup script", {
                    threadId,
                    projectId: project.id,
                    worktreePath,
                    detail,
                  }),
                ),
              );
          }

          yield* orchestration
            .dispatch({
              type: "thread.turn.start",
              commandId: yield* nextCommandId("turn-start"),
              threadId,
              message: {
                messageId: yield* nextMessageId,
                role: "user",
                text: input.prompt,
                attachments: [],
              },
              modelSelection,
              titleSeed: input.title,
              runtimeMode: "full-access",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              createdAt,
            })
            .pipe(
              Effect.mapError(
                (detail) => new PluginRuntimeError("Failed to start automation turn.", detail),
              ),
            );

          return { threadId };
        }).pipe(
          Effect.catch((detail) =>
            cleanupCreatedThread().pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  detail instanceof PluginRuntimeError
                    ? detail
                    : new PluginRuntimeError("Failed to launch automation thread.", detail),
                ),
              ),
            ),
          ),
        );
      }),
  } satisfies PluginActivationContext["runtime"];
});

function makeActivationContext(input: {
  readonly pluginId: PluginId;
  readonly store: PluginStore["Service"];
  readonly registry: PluginRegistry["Service"];
  readonly runtime: PluginActivationContext["runtime"];
}): PluginActivationContext {
  const { pluginId, store, registry, runtime } = input;
  return {
    pluginId,
    store: {
      registerCollection: (collection, schema) =>
        store.registerCollection(pluginId, collection, schema as Schema.Codec<unknown, unknown>),
      list: <A>(collection: string) =>
        store.list<A>(pluginId, collection).pipe(Effect.mapError(toApiStoreError)),
      get: <A>(collection: string, documentId: string) =>
        store.get<A>(pluginId, collection, documentId).pipe(Effect.mapError(toApiStoreError)),
      upsert: (collection, documentId, document) =>
        store
          .upsert(pluginId, collection, documentId, document)
          .pipe(Effect.mapError(toApiStoreError)),
      delete: (collection, documentId) =>
        store.delete(pluginId, collection, documentId).pipe(Effect.mapError(toApiStoreError)),
      deleteCollection: (collection) =>
        store.deleteCollection(pluginId, collection).pipe(Effect.mapError(toApiStoreError)),
    },
    commands: {
      register: (command, registration) =>
        registry.registerCommand(pluginId, command, registration),
    },
    navigation: {
      setBadgeProvider: (routeId, provider) =>
        registry.setBadgeProvider(pluginId, routeId, provider),
    },
    runtime,
    events: {
      publish: (event) => registry.publish(pluginId, event),
    },
  };
}

const makePluginHost = Effect.gen(function* () {
  const store = yield* PluginStore;
  const registry = yield* PluginRegistry;
  const packageResolver = yield* PluginPackageResolver;
  const runtime = yield* makePluginRuntimeApi;
  const pluginScopes = new Map<PluginId, Scope.Scope>();

  yield* Effect.addFinalizer(() =>
    Effect.forEach(pluginScopes.values(), (scope) => Scope.close(scope, Exit.void), {
      concurrency: 1,
      discard: true,
    }).pipe(Effect.ignoreCause({ log: true })),
  );

  const activatePlugin = (pluginPackage: LoadedServerPlugin) =>
    Effect.gen(function* () {
      const plugin = pluginPackage.serverPlugin;
      const pluginId = pluginPackage.manifest.id;
      const pluginScope = yield* Scope.make("sequential");
      yield* Scope.addFinalizer(
        pluginScope,
        registry.clearPluginContributions(pluginId).pipe(Effect.ignoreCause({ log: true })),
      );
      pluginScopes.set(pluginId, pluginScope);
      const context = makeActivationContext({
        pluginId,
        store,
        registry,
        runtime,
      });
      yield* plugin.activate(context).pipe(Effect.provideService(Scope.Scope, pluginScope));
      yield* registry.registerActivePlugin(pluginPackage);
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const pluginId = pluginPackage.manifest.id;
          const pluginScope = pluginScopes.get(pluginId);
          if (pluginScope) {
            pluginScopes.delete(pluginId);
            yield* Scope.close(pluginScope, Exit.void).pipe(Effect.ignoreCause({ log: true }));
          }
          yield* registry.registerFailedPlugin(pluginPackage, errorMessage(error));
        }).pipe(
          Effect.flatMap(() =>
            Effect.logWarning("Plugin activation failed", {
              pluginId: pluginPackage.manifest.id,
              error,
            }),
          ),
        ),
      ),
    );

  const activateInstalledPlugins = packageResolver.discover.pipe(
    Effect.flatMap((packages) =>
      Effect.forEach(packages, activatePlugin, {
        concurrency: 1,
        discard: true,
      }),
    ),
  );

  return PluginHost.of({
    activateInstalledPlugins,
  });
});

export const PluginHostLive = Layer.effect(PluginHost, makePluginHost);

export const PluginHostStartupLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    yield* host.activateInstalledPlugins;
  }),
);
