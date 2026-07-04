// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { WorkflowGitHubPollerLive } from "./Layers/WorkflowGitHubPoller.ts";
import { GitHubPortLive } from "./Layers/GitHubPort.ts";
import { AsanaProviderLive } from "./Layers/AsanaProvider.ts";
import { BoardRegistryLive } from "./Layers/BoardRegistry.ts";
import { GithubIssuesProviderLive } from "./Layers/GithubIssuesProvider.ts";
import { JiraProviderLive } from "./Layers/JiraProvider.ts";
import { ProjectWorkspaceResolverLive } from "./Layers/ProjectWorkspaceResolver.ts";
import { WorkflowEngineLayer } from "./Layers/WorkflowEngine.ts";
import { ScriptCommandRunnerLive } from "./Layers/ScriptCommandRunner.ts";
import { SetupTerminalPortLive } from "./Layers/SetupRunService.ts";
import { MergeGitPortLive } from "./Layers/TicketMergeService.ts";
import { WorkflowTerminalRetentionSweeperLive } from "./Layers/WorkflowTerminalRetentionSweeper.ts";
import { WorkflowThreadJanitorLive } from "./Layers/WorkflowThreadJanitor.ts";
import {
  WorkflowFileLoaderLive,
  WorkflowFilePortLive,
  WorkflowProviderInstancePortLive,
} from "./Layers/WorkflowFileLoader.ts";
import { WorkflowReadModelLive } from "./Layers/WorkflowReadModel.ts";
import { makeWorkflowWebhookLive, WorkflowWebhookLive } from "./Layers/WorkflowWebhook.ts";
import { WorkflowWorktreeJanitorLive } from "./Layers/WorkflowWorktreeJanitor.ts";
import { WorkSourceProviderRegistryLive } from "./Layers/WorkSourceProviderRegistry.ts";
import { WorkflowSourceSyncerLive } from "./Layers/WorkflowSourceSyncer.ts";
import { WorkflowFilesystemCapability } from "./Services/WorkflowCapabilities.ts";
import { WorkflowEngineCoreLive } from "./WorkflowEngineCoreLive.ts";

const platformError = (method: string, pathOrDescriptor: string | number, cause: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "workflowRuntimeFileSystem",
    method,
    pathOrDescriptor,
    cause,
  });

const pathInputFor = (
  filesystem: WorkflowFilesystemCapability["Service"],
  method: string,
  absolutePath: string,
) =>
  filesystem.listRoots().pipe(
    Effect.mapError((cause) => platformError(method, absolutePath, cause)),
    Effect.flatMap((roots) => {
      const root = roots
        .filter((candidate) => {
          const relative = NodePath.relative(candidate, absolutePath);
          return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
        })
        .sort((a, b) => b.length - a.length)[0];
      if (root === undefined) {
        return Effect.fail(
          platformError(
            method,
            absolutePath,
            new Error("path is outside plugin filesystem grants"),
          ),
        );
      }
      return Effect.succeed({
        root,
        relativePath: NodePath.relative(root, absolutePath),
      });
    }),
  );

const WorkflowRuntimeFileSystemLive = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const filesystem = yield* WorkflowFilesystemCapability;
    const withPath = <A>(
      method: string,
      absolutePath: string,
      run: (input: {
        readonly root: string;
        readonly relativePath: string;
      }) => Effect.Effect<A, Error>,
    ) =>
      pathInputFor(filesystem, method, absolutePath).pipe(
        Effect.flatMap(run),
        Effect.mapError((cause) => platformError(method, absolutePath, cause)),
      );

    return FileSystem.makeNoop({
      exists: (path) =>
        pathInputFor(filesystem, "exists", path).pipe(
          Effect.flatMap((input) => filesystem.exists(input)),
          Effect.orElseSucceed(() => false),
        ),
      makeDirectory: (path) =>
        withPath("makeDirectory", path, (input) => filesystem.makeDirectory(input)),
      readFileString: (path) =>
        withPath("readFileString", path, (input) => filesystem.readFileString(input)),
      realPath: (path) =>
        withPath("realPath", path, (input) =>
          filesystem.stat(input).pipe(Effect.map((stat) => stat.realPath ?? path)),
        ),
      remove: (path) => withPath("remove", path, (input) => filesystem.remove(input)),
      writeFileString: (path, data) =>
        withPath("writeFileString", path, (input) =>
          filesystem.writeFileString({ ...input, contents: data }),
        ),
    });
  }),
);

const WorkflowRuntimeCryptoLive = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(NodeCrypto.randomBytes(size)),
    digest: (algorithm, data) =>
      Effect.sync(
        () =>
          new Uint8Array(
            NodeCrypto.createHash(algorithm.toLowerCase().replace("-", "")).update(data).digest(),
          ),
      ),
  }),
);

const WorkflowRuntimePlatformLive = Layer.mergeAll(
  Path.layer,
  WorkflowRuntimeCryptoLive,
  WorkflowRuntimeFileSystemLive,
);

export const WorkflowRuntimeCoreLive = Layer.mergeAll(
  WorkflowTerminalRetentionSweeperLive.pipe(Layer.provideMerge(WorkflowEngineLayer)),
  WorkflowGitHubPollerLive.pipe(Layer.provideMerge(WorkflowEngineLayer)),
  WorkflowSourceSyncerLive.pipe(
    Layer.provideMerge(WorkflowEngineLayer),
    Layer.provideMerge(
      WorkSourceProviderRegistryLive.pipe(
        Layer.provide(GithubIssuesProviderLive),
        Layer.provide(AsanaProviderLive),
        Layer.provide(JiraProviderLive),
      ),
    ),
  ),
).pipe(Layer.provideMerge(WorkflowEngineCoreLive));

export const WorkflowDaemonLive = WorkflowRuntimeCoreLive.pipe(
  Layer.provideMerge(WorkflowWorktreeJanitorLive),
  Layer.provideMerge(WorkflowThreadJanitorLive),
  Layer.provideMerge(GitHubPortLive),
  Layer.provideMerge(MergeGitPortLive),
);

const WorkflowRuntimeReadModelLive = WorkflowReadModelLive.pipe(
  Layer.provideMerge(BoardRegistryLive),
);

const WorkflowRuntimeFileLoaderLive = WorkflowFileLoaderLive.pipe(
  Layer.provideMerge(WorkflowFilePortLive),
  Layer.provideMerge(WorkflowProviderInstancePortLive),
  Layer.provideMerge(BoardRegistryLive),
  Layer.provideMerge(WorkflowRuntimeReadModelLive),
);

export interface WorkflowRuntimeLiveOptions {
  readonly webhookBasePath?: string;
}

export const makeWorkflowRuntimeLive = (options?: WorkflowRuntimeLiveOptions) => {
  const webhookLayer =
    options?.webhookBasePath === undefined
      ? WorkflowWebhookLive
      : makeWorkflowWebhookLive({ basePath: options.webhookBasePath });

  return WorkflowDaemonLive.pipe(
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(WorkflowRuntimeReadModelLive),
    Layer.provideMerge(ProjectWorkspaceResolverLive),
    Layer.provideMerge(WorkflowRuntimeFileLoaderLive),
    Layer.provideMerge(ScriptCommandRunnerLive),
    Layer.provideMerge(SetupTerminalPortLive),
    Layer.provideMerge(webhookLayer),
    Layer.provideMerge(WorkflowRuntimePlatformLive),
  );
};

export const WorkflowRuntimeLive = makeWorkflowRuntimeLive();
