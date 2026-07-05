import {
  HOST_API_VERSION,
  PluginManifest,
  hostApiSatisfies,
  type PluginId,
  type PluginLockfile,
  type PluginLockfilePlugin,
  type PluginState,
} from "@t3tools/contracts/plugin";
import type {
  PluginDefinition,
  PluginHostApi,
  PluginLogger,
  PluginRegistration,
  PluginServiceDescriptor,
} from "@t3tools/plugin-sdk";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerLifecycleEvents from "../serverLifecycleEvents.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectionThreadActivities from "../persistence/Services/ProjectionThreadActivities.ts";
import * as ProjectionThreadMessages from "../persistence/Services/ProjectionThreadMessages.ts";
import * as ProjectionTurns from "../persistence/Services/ProjectionTurns.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { makeAgentsCapability } from "./capabilities/AgentsCapability.ts";
import { makeDatabaseCapability } from "./capabilities/DatabaseCapability.ts";
import { makeEnvironmentsReadCapability } from "./capabilities/EnvironmentsReadCapability.ts";
import { makeFilesystemCapability } from "./capabilities/FilesystemCapability.ts";
import { makeHttpCapability } from "./capabilities/HttpCapability.ts";
import {
  makeHttpClientCapability,
  PluginHttpClientTransportService,
} from "./capabilities/HttpClientCapability.ts";
import { makeProjectionsReadCapability } from "./capabilities/ProjectionsReadCapability.ts";
import { makeSecretsCapability } from "./capabilities/SecretsCapability.ts";
import { makeSourceControlCapability } from "./capabilities/SourceControlCapability.ts";
import { makeTerminalsCapability } from "./capabilities/TerminalsCapability.ts";
import { makeTextGenerationCapability } from "./capabilities/TextGenerationCapability.ts";
import { makeVcsCapability } from "./capabilities/VcsCapability.ts";
import { OutboundUrlLookup } from "./OutboundUrlValidator.ts";
import { PluginLockfileStore } from "./PluginLockfileStore.ts";
import { PluginHttpRegistry } from "./PluginHttpRegistry.ts";
import { PluginMigrator } from "./PluginMigrator.ts";
import { PluginModuleLoader } from "./PluginModuleLoader.ts";
import { makePluginLogger } from "./PluginLogger.ts";
import { pluginDataDir, pluginManifestPath, pluginVersionDir } from "./PluginPaths.ts";
import { PluginRuntimeRegistry } from "./PluginRuntimeRegistry.ts";
import { makePluginWorkspaceGrants, type PluginWorkspaceGrants } from "./PluginWorkspaceGrants.ts";

const APP_VERSION = packageJson.version;
const PRESERVE_DATA_MARKER = ".preserve-data-on-remove";
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(PluginManifest));

const healthyActivationDelay = () => {
  const overrideMs = Number.parseInt(process.env.T3_PLUGIN_HOST_HEALTHY_DELAY_MS ?? "", 10);
  return Number.isFinite(overrideMs) && overrideMs >= 0
    ? Duration.millis(overrideMs)
    : Duration.seconds(30);
};

// Bound plugin-controlled register()/recover() so an unresponsive plugin fails
// activation via the normal failure path instead of stalling the host: a hung
// register()/recover() would otherwise block server startup or an
// install/enable request indefinitely.
const registrationTimeout = () => {
  const overrideMs = Number.parseInt(process.env.T3_PLUGIN_HOST_REGISTER_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(overrideMs) && overrideMs > 0
    ? Duration.millis(overrideMs)
    : Duration.seconds(30);
};

export class PluginRegistrationError extends Schema.TaggedErrorClass<PluginRegistrationError>()(
  "PluginRegistrationError",
  { pluginId: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Plugin ${this.pluginId} returned an invalid registration: ${this.detail}`;
  }
}

// Internal control-flow sentinel: raised when an activation is intentionally
// cancelled by a concurrent lifecycle change (see the pre-put state re-check in
// loadPlugin). It is deliberately NOT part of the plugin SDK/contract surface —
// it only travels inside the host's failure channel so a self-cancel can be
// told apart from a genuine fiber interruption (host shutdown) and from a real
// activation error.
export class PluginActivationCanceled extends Schema.TaggedErrorClass<PluginActivationCanceled>()(
  "PluginActivationCanceled",
  { pluginId: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `Plugin ${this.pluginId} activation was canceled: ${this.reason}`;
  }
}

// True when a cause carries the activation-cancel sentinel as a typed failure.
// Iterating cause.reasons and narrowing with isFailReason is the idiomatic
// effect-4 way to inspect a cause for a specific tagged error; Schema.is is the
// schema-aware runtime check for the tagged-error value.
const isActivationCanceled = Schema.is(PluginActivationCanceled);
const causeHasActivationCanceled = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.some((reason) => Cause.isFailReason(reason) && isActivationCanceled(reason.error));

export class PluginCapabilityUnavailable extends Schema.TaggedErrorClass<PluginCapabilityUnavailable>()(
  "PluginCapabilityUnavailable",
  { capability: Schema.String },
) {
  override get message(): string {
    return `Capability ${this.capability} is not available in this host build.`;
  }
}

export class PluginHost extends Context.Service<
  PluginHost,
  {
    readonly start: Effect.Effect<void>;
    readonly activatePlugin: (pluginId: PluginId) => Effect.Effect<void>;
    readonly deactivatePlugin: (pluginId: PluginId) => Effect.Effect<void>;
  }
>()("t3/plugins/PluginHost") {}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}

const resolveRegistration = (
  pluginId: PluginId,
  definition: PluginDefinition,
  hostApi: PluginHostApi,
) =>
  Effect.suspend(() => {
    const value = definition.register(hostApi);
    if (Effect.isEffect(value)) return value;
    if (isPromiseLike(value)) return Effect.promise(() => value as Promise<PluginRegistration>);
    return Effect.succeed(value);
  }).pipe(
    Effect.catchCause((cause) =>
      // A clean host shutdown interrupts the activation fiber mid-register();
      // let that interruption propagate instead of persisting a spurious
      // "failed" registration error.
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<never>)
        : Effect.fail(
            new PluginRegistrationError({
              pluginId,
              detail: Cause.pretty(cause),
            }),
          ),
    ),
  );

function validateRegistration(
  pluginId: PluginId,
  registration: PluginRegistration,
): Effect.Effect<void, PluginRegistrationError> {
  const methods = new Set<string>();
  for (const rpc of registration.rpc ?? []) {
    if (rpc.scope !== "read" && rpc.scope !== "operate") {
      return Effect.fail(
        new PluginRegistrationError({ pluginId, detail: `invalid RPC scope ${rpc.scope}` }),
      );
    }
    if (methods.has(rpc.method)) {
      return Effect.fail(
        new PluginRegistrationError({ pluginId, detail: `duplicate RPC method ${rpc.method}` }),
      );
    }
    methods.add(rpc.method);
  }
  return Effect.void;
}

const unavailable = (capability: string) =>
  // Typed failure (not a defect) so a plugin that calls an undeclared capability
  // can catch/degrade gracefully instead of crashing the call as a defect.
  Effect.fail(new PluginCapabilityUnavailable({ capability }));

const makeHostApi = (input: {
  readonly pluginId: PluginId;
  readonly capabilities: ReadonlyArray<PluginManifest["capabilities"][number]>;
  readonly dataDir: string;
  readonly logger: PluginLogger;
  readonly grants: PluginWorkspaceGrants;
  readonly deps: {
    readonly sql: SqlClient.SqlClient;
    readonly secretStore: ServerSecretStore.ServerSecretStore["Service"];
    readonly config: ServerConfig.ServerConfig["Service"];
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly environment: ServerEnvironment.ServerEnvironment["Service"];
    readonly orchestrationEngine: OrchestrationEngine.OrchestrationEngineService["Service"];
    readonly snapshots: ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"];
    readonly turns: ProjectionTurns.ProjectionTurnRepository["Service"];
    readonly messages: ProjectionThreadMessages.ProjectionThreadMessageRepository["Service"];
    readonly activities: ProjectionThreadActivities.ProjectionThreadActivityRepository["Service"];
    readonly providerInstances: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"];
    readonly git: GitVcsDriver.GitVcsDriver["Service"];
    readonly checkpointStore: CheckpointStore.CheckpointStore["Service"];
    readonly textGeneration: TextGeneration.TextGeneration["Service"];
    readonly sourceControlRegistry: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"];
    readonly github: GitHubCli.GitHubCli["Service"];
    readonly terminals: TerminalManager.TerminalManager["Service"];
    readonly outboundLookup: OutboundUrlLookup["Service"];
    readonly httpClientTransport: PluginHttpClientTransportService["Service"];
  };
}): { readonly api: PluginHostApi; readonly teardown: ReadonlyArray<Effect.Effect<void>> } => {
  const capabilities = new Set(input.capabilities);
  const available = <A>(capability: PluginManifest["capabilities"][number], value: A) =>
    capabilities.has(capability) ? Effect.succeed(value) : unavailable(capability);

  const terminalsBundle = makeTerminalsCapability({
    pluginId: input.pluginId,
    manager: input.deps.terminals,
  });
  const teardown: Array<Effect.Effect<void>> = [];
  if (capabilities.has("terminals")) {
    teardown.push(terminalsBundle.shutdown);
  }

  const api: PluginHostApi = {
    hostApiVersion: HOST_API_VERSION,
    config: {
      appVersion: APP_VERSION,
      hostApiVersion: HOST_API_VERSION,
      dataDir: input.dataDir,
      logger: input.logger,
    },
    agents: available(
      "agents",
      makeAgentsCapability({
        pluginId: input.pluginId,
        engine: input.deps.orchestrationEngine,
        snapshots: input.deps.snapshots,
        turns: input.deps.turns,
        messages: input.deps.messages,
        providerInstances: input.deps.providerInstances,
      }),
    ),
    vcs: available(
      "vcs",
      makeVcsCapability({
        git: input.deps.git,
        checkpoints: input.deps.checkpointStore,
        grants: input.grants,
      }),
    ),
    terminals: available("terminals", terminalsBundle.capability),
    database: available("database", makeDatabaseCapability(input.deps.sql)),
    projectionsRead: available(
      "projections.read",
      makeProjectionsReadCapability({
        snapshots: input.deps.snapshots,
        turns: input.deps.turns,
        messages: input.deps.messages,
        activities: input.deps.activities,
      }),
    ),
    environmentsRead: available(
      "environments.read",
      makeEnvironmentsReadCapability({
        environment: input.deps.environment,
        snapshots: input.deps.snapshots,
      }),
    ),
    secrets: available(
      "secrets",
      makeSecretsCapability({
        pluginId: input.pluginId,
        store: input.deps.secretStore,
        config: input.deps.config,
        fileSystem: input.deps.fileSystem,
        path: input.deps.path,
      }),
    ),
    http: available("http", makeHttpCapability(input.pluginId)),
    filesystem: available(
      "filesystem",
      makeFilesystemCapability({
        snapshots: input.deps.snapshots,
        grants: input.grants,
      }),
    ),
    httpClient: available(
      "httpClient",
      makeHttpClientCapability({
        lookup: input.deps.outboundLookup,
        transport: input.deps.httpClientTransport,
      }),
    ),
    sourceControl: available(
      "sourceControl",
      makeSourceControlCapability({
        registry: input.deps.sourceControlRegistry,
        github: input.deps.github,
      }),
    ),
    textGeneration: available(
      "textGeneration",
      makeTextGenerationCapability(input.deps.textGeneration),
    ),
  };

  return { api, teardown };
};

const upgradeLockfileEntry = (
  entry: PluginLockfilePlugin,
  staged: NonNullable<PluginLockfilePlugin["staged"]>,
): PluginLockfilePlugin => ({
  version: staged.version,
  sha256: staged.sha256,
  sourceId: entry.sourceId,
  enabled: entry.enabled,
  state: "active",
  // Reset activation health for the new build. Carrying over the old version's
  // crashCount could immediately trip the repeated-crash safe mode on the first
  // startup of the upgrade, and its lastError would surface a stale failure the
  // new version never produced. activatingSince starts null; loadPlugin sets it
  // when the fresh activation begins.
  activation: { activatingSince: null, crashCount: 0 },
  installedAt: entry.installedAt,
  lastError: null,
});

const getLockfilePlugin = (lockfile: PluginLockfile, pluginId: PluginId) =>
  (lockfile.plugins as Readonly<Record<string, PluginLockfilePlugin | undefined>>)[pluginId];

const updateFailure = (
  store: PluginLockfileStore["Service"],
  pluginId: PluginId,
  message: string,
) =>
  store.updatePlugin(pluginId, ({ current }) =>
    Effect.succeed(
      current
        ? {
            ...current,
            // Only an in-flight activation ("active") should flip to "failed".
            // If the user concurrently disabled/uninstalled/upgraded the plugin
            // while it was activating, preserve that requested lifecycle state
            // rather than clobbering it with "failed".
            state: current.state === "active" ? "failed" : current.state,
            lastError: message,
            activation: {
              ...current.activation,
              activatingSince: null,
            },
          }
        : undefined,
    ),
  );

const startService = (input: {
  readonly pluginId: PluginId;
  readonly logger: PluginLogger;
  readonly service: PluginServiceDescriptor;
}) =>
  input.service.run({ pluginId: input.pluginId, logger: input.logger }).pipe(
    Effect.catchCause((cause) =>
      input.logger.error("plugin service failed; restarting", {
        service: input.service.name,
        cause: Cause.pretty(cause),
      }),
    ),
    // Exponential backoff capped at 30s so a flapping service keeps
    // retrying at a bounded cadence instead of backing off forever.
    Effect.repeat(
      Schedule.either(Schedule.exponential("250 millis"), Schedule.spaced("30 seconds")),
    ),
  );

export const make = Effect.fn("PluginHost.make")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const store = yield* PluginLockfileStore;
  const loader = yield* PluginModuleLoader;
  const migrator = yield* PluginMigrator;
  const registry = yield* PluginRuntimeRegistry;
  const httpRegistry = yield* PluginHttpRegistry;
  const clock = yield* Clock.Clock;
  const sql = yield* SqlClient.SqlClient;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const turns = yield* ProjectionTurns.ProjectionTurnRepository;
  const messages = yield* ProjectionThreadMessages.ProjectionThreadMessageRepository;
  const activities = yield* ProjectionThreadActivities.ProjectionThreadActivityRepository;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const sourceControlRegistry = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const github = yield* GitHubCli.GitHubCli;
  const terminals = yield* TerminalManager.TerminalManager;
  const outboundLookup = yield* OutboundUrlLookup;
  const httpClientTransport = yield* PluginHttpClientTransportService;
  const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;

  const publishPluginStateChanged = (pluginId: PluginId, state: PluginState) =>
    lifecycleEvents
      .publish({
        version: 1,
        type: "plugins",
        payload: {
          kind: "plugin-state-changed",
          pluginId,
          state,
        },
      })
      .pipe(Effect.ignoreCause({ log: true }), Effect.asVoid);

  const markFailure = (pluginId: PluginId, message: string) =>
    updateFailure(store, pluginId, message).pipe(
      // Publish the state that was actually persisted: updateFailure preserves a
      // concurrently-requested lifecycle state (disabled/pending-remove/...)
      // instead of forcing "failed", so announce that rather than a stale
      // "failed".
      Effect.flatMap((lockfile) => {
        const state = getLockfilePlugin(lockfile, pluginId)?.state;
        return state === undefined ? Effect.void : publishPluginStateChanged(pluginId, state);
      }),
    );

  // Clear ONLY the in-flight activation marker, preserving state/crashCount/
  // lastError. Used after a clean interrupt/cancel teardown so reconcile on the
  // next start does not mistake the intentional cancellation for a crash (a
  // lingering activatingSince bumps crashCount and eventually forces "failed").
  const clearActivatingMarker = (pluginId: PluginId) =>
    store
      .updatePlugin(pluginId, ({ current }) =>
        Effect.succeed(
          current
            ? { ...current, activation: { ...current.activation, activatingSince: null } }
            : undefined,
        ),
      )
      .pipe(Effect.ignore);

  // Outer handler for a loadPlugin failure that escaped the activation-exit
  // block (setup errors, or a re-raised interrupt/cancel from that block).
  // Three dispositions:
  //   - interrupt-only (clean shutdown / scope close): re-raise so it keeps
  //     propagating and the host stops promptly.
  //   - activation-cancel sentinel (concurrent disable/uninstall aborted the
  //     activation): benign — the teardown already ran and the marker was
  //     cleared, so just log and swallow, leaving the persisted state intact.
  //   - anything else (genuine error): persist "failed" and log.
  const handleLoadFailureCause = (
    pluginId: PluginId,
    logMessage: string,
    cause: Cause.Cause<unknown>,
  ) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause as Cause.Cause<never>)
      : causeHasActivationCanceled(cause)
        ? Effect.logWarning("Plugin activation canceled", {
            pluginId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.ignore)
        : markFailure(pluginId, Cause.pretty(cause)).pipe(
            Effect.andThen(Effect.logWarning(logMessage, { pluginId, cause: Cause.pretty(cause) })),
            Effect.ignore,
          );

  const readManifest = (pluginDir: string) =>
    fs
      .readFileString(pluginManifestPath(pluginDir, path.join))
      .pipe(Effect.flatMap(decodeManifest));

  const loadPlugin = (pluginId: PluginId, entry: PluginLockfilePlugin) =>
    Effect.gen(function* () {
      const pluginDir = pluginVersionDir(config.pluginsDir, pluginId, entry.version, path.join);
      const manifest = yield* readManifest(pluginDir);
      if (manifest.id !== pluginId) {
        return yield* new PluginRegistrationError({
          pluginId,
          detail: `manifest id ${manifest.id} does not match lockfile id`,
        });
      }
      if (!hostApiSatisfies(manifest.hostApi, HOST_API_VERSION)) {
        yield* store
          .updatePlugin(pluginId, ({ current }) =>
            Effect.succeed(current ? { ...current, state: "disabled-by-host" } : undefined),
          )
          .pipe(Effect.tap(() => publishPluginStateChanged(pluginId, "disabled-by-host")));
        yield* Effect.logWarning("Plugin disabled by host API version mismatch", {
          pluginId,
          requested: manifest.hostApi,
          hostApiVersion: HOST_API_VERSION,
        });
        return;
      }
      if (!manifest.entries.server) {
        yield* Effect.logDebug("Skipping web-only plugin in server plugin host", { pluginId });
        return;
      }

      const serverEntry = manifest.entries.server;
      const serverEntryPath = path.join(pluginDir, serverEntry);
      if (!(yield* fs.exists(pluginDir)) || !(yield* fs.exists(serverEntryPath))) {
        yield* markFailure(pluginId, "plugin directory or server entry is missing");
        return;
      }

      const activatingSince = DateTime.formatIso(yield* DateTime.now);
      yield* store.updatePlugin(pluginId, ({ current }) =>
        Effect.succeed(
          current
            ? {
                ...current,
                activation: {
                  ...current.activation,
                  activatingSince,
                },
              }
            : undefined,
        ),
      );

      const scope = yield* Scope.make("sequential");
      const readiness = yield* Deferred.make<void>();
      const logger = makePluginLogger(pluginId);
      const dataDir = pluginDataDir(config.pluginsDir, pluginId, path.join);
      const grants = yield* makePluginWorkspaceGrants;
      const { api: hostApi, teardown: hostApiTeardown } = makeHostApi({
        pluginId,
        capabilities: manifest.capabilities,
        dataDir,
        logger,
        grants,
        deps: {
          sql,
          secretStore,
          config,
          fileSystem: fs,
          path,
          environment,
          orchestrationEngine,
          snapshots,
          turns,
          messages,
          activities,
          providerInstances,
          git,
          checkpointStore,
          textGeneration,
          sourceControlRegistry,
          github,
          terminals,
          outboundLookup,
          httpClientTransport,
        },
      });

      const activation = Effect.gen(function* () {
        // Register capability teardowns (e.g. killing leaked terminals) on the
        // plugin scope before running any plugin code, so cleanup fires on
        // EVERY exit path — activation failure, stop, disable, crash.
        for (const teardown of hostApiTeardown) {
          yield* Scope.addFinalizer(scope, teardown);
        }
        yield* fs.makeDirectory(dataDir, { recursive: true });
        const definition = yield* loader.loadServerEntry(pluginDir, serverEntry);
        const registration = yield* resolveRegistration(pluginId, definition, hostApi).pipe(
          Effect.timeout(registrationTimeout()),
        );
        yield* validateRegistration(pluginId, registration);
        yield* migrator.run(pluginId, registration.migrations ?? []);
        if (registration.recover) {
          yield* registration.recover().pipe(Effect.timeout(registrationTimeout()));
        }
        if (manifest.capabilities.includes("http") && (registration.http?.length ?? 0) > 0) {
          yield* httpRegistry.put(pluginId, registration.http ?? []);
          yield* Scope.addFinalizer(scope, httpRegistry.remove(pluginId));
        }
        // Re-check lifecycle state right before publishing the runtime. A
        // concurrent disable/uninstall flips the lockfile and runs
        // deactivatePlugin, which finds no runtime yet (we have not put it) and
        // returns early. Without this guard activation would finish and the
        // now-disabled/pending-remove plugin's runtime + services + HTTP routes
        // would go live anyway. Abort via the typed cancel sentinel (NOT a fiber
        // interrupt) so the failure branch closes the scope (removing any partial
        // HTTP registration), skips the registry.put + "active" publish, clears
        // the activating marker, and leaves the persisted state intact — while
        // staying distinguishable from a genuine host-shutdown interruption.
        const stateBeforePut = yield* store.readLockfile.pipe(
          Effect.map((current) => getLockfilePlugin(current, pluginId)?.state),
          Effect.orElseSucceed(() => undefined as PluginState | undefined),
        );
        if (stateBeforePut !== "active") {
          return yield* new PluginActivationCanceled({
            pluginId,
            reason: `lifecycle state changed to ${stateBeforePut ?? "missing"} during activation`,
          });
        }
        yield* registry.put(pluginId, { manifest, registration, readiness, scope });
        for (const service of registration.services ?? []) {
          yield* startService({ pluginId, logger, service }).pipe(
            Effect.forkScoped,
            Scope.provide(scope),
          );
        }
        yield* Deferred.succeed(readiness, undefined).pipe(Effect.orDie);
        // Clear activatingSince immediately on successful activation. Activation
        // has COMPLETED, so the plugin is no longer "activating"; leaving the
        // marker set until the delayed healthy-clear fires would make an
        // unrelated process restart within the stability window look like an
        // interrupted activation, wrongly incrementing crashCount and eventually
        // failing a healthy plugin. crashCount is still only forgiven (reset to
        // 0) after the stability window, so genuine activation-time crash loops
        // keep accumulating across restarts.
        const markActivated = (forgiveCrashes: boolean) =>
          store.updatePlugin(pluginId, ({ current }) =>
            Effect.succeed(
              current
                ? {
                    ...current,
                    activation: {
                      activatingSince: null,
                      crashCount: forgiveCrashes ? 0 : current.activation.crashCount,
                    },
                    lastError: null,
                  }
                : undefined,
            ),
          );
        yield* markActivated(false);
        const healthyDelay = healthyActivationDelay();
        if (Duration.toMillis(healthyDelay) === 0) {
          yield* markActivated(true);
        } else {
          yield* clock.sleep(healthyDelay).pipe(
            Effect.flatMap(() => markActivated(true)),
            Effect.ignoreCause({ log: true }),
            Effect.forkScoped,
            Scope.provide(scope),
          );
        }
      });

      const exit = yield* activation.pipe(Scope.provide(scope), Effect.exit);
      if (Exit.isFailure(exit)) {
        yield* Scope.close(scope, exit);
        // Activation may have already inserted the runtime into the registry
        // (registry.put runs mid-activation, before later steps). On failure the
        // scope is now closed, so drop the stale entry — otherwise registry.get
        // and registry.list keep reporting the plugin as active with a dead
        // scope and an unresolved readiness Deferred.
        yield* registry.remove(pluginId).pipe(Effect.ignore);
        if (Cause.hasInterruptsOnly(exit.cause)) {
          // Genuine interruption: a clean host shutdown (scope close / stop). The
          // teardown above already ran, so this is NOT a crash — clear the
          // activating marker so reconcile on the next start does not miscount
          // it, then propagate the interruption so the persisted lifecycle state
          // stays intact and the host stops promptly.
          yield* clearActivatingMarker(pluginId);
          return yield* Effect.failCause(exit.cause as Cause.Cause<never>);
        }
        if (causeHasActivationCanceled(exit.cause)) {
          // A concurrent disable/uninstall cancelled this activation via the
          // pre-put re-check. The teardown above already ran (not a crash) —
          // clear the activating marker and re-raise the typed sentinel so
          // callers can tell it apart from a genuine error (do NOT mark
          // "failed") and from a shutdown interrupt (hasInterruptsOnly is false
          // for the sentinel, so downstream detects it via
          // causeHasActivationCanceled).
          yield* clearActivatingMarker(pluginId);
          return yield* Effect.failCause(exit.cause as Cause.Cause<never>);
        }
        const message = Cause.pretty(exit.cause);
        yield* markFailure(pluginId, message);
        yield* Effect.logWarning("Plugin activation failed", { pluginId, cause: message });
      } else {
        // Announce the state actually persisted, not a hardcoded "active", so a
        // concurrent disable/uninstall (which flips the lockfile and runs
        // deactivatePlugin after registry.put but before this publish) isn't
        // contradicted.
        const persistedState = yield* store.readLockfile.pipe(
          Effect.map((lockfile) => getLockfilePlugin(lockfile, pluginId)?.state ?? "active"),
          Effect.orElseSucceed(() => "active" as PluginState),
        );
        yield* publishPluginStateChanged(pluginId, persistedState);
      }
    });

  const activatePlugin: PluginHost["Service"]["activatePlugin"] = (pluginId) =>
    Effect.gen(function* () {
      if (process.env.T3_NO_PLUGINS === "1") {
        yield* Effect.logInfo("Plugin host disabled by T3_NO_PLUGINS", { pluginId });
        return;
      }
      const active = yield* registry.get(pluginId);
      if (Option.isSome(active)) return;
      const lockfile = yield* store.readLockfile.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Plugin hot activation could not read lockfile", {
            pluginId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as({ plugins: {}, sources: [] })),
        ),
      );
      const entry = getLockfilePlugin(lockfile, pluginId);
      if (!entry?.enabled || entry.state !== "active") return;
      yield* loader.ensureHostSingletonResolution;
      yield* loadPlugin(pluginId, entry).pipe(
        Effect.catchCause((cause) =>
          handleLoadFailureCause(pluginId, "Plugin hot activation failed", cause),
        ),
      );
    });

  const deactivatePlugin: PluginHost["Service"]["deactivatePlugin"] = (pluginId) =>
    Effect.gen(function* () {
      const runtime = yield* registry.get(pluginId);
      if (Option.isNone(runtime)) return;
      yield* Scope.close(runtime.value.scope, Exit.void).pipe(Effect.ignore);
      yield* registry.remove(pluginId);
      yield* httpRegistry.remove(pluginId).pipe(Effect.ignore);
      // Announce the state that is actually persisted rather than a hardcoded
      // "disabled": uninstall sets "pending-remove" then calls this, and
      // publishing "disabled" would contradict the lockfile + list APIs.
      const persistedState = yield* store.readLockfile.pipe(
        Effect.map((lockfile) => getLockfilePlugin(lockfile, pluginId)?.state ?? "disabled"),
        Effect.orElseSucceed(() => "disabled" as PluginState),
      );
      yield* publishPluginStateChanged(pluginId, persistedState);
    });

  const reconcilePendingState = (pluginId: PluginId, entry: PluginLockfilePlugin) =>
    Effect.gen(function* () {
      if (entry.state === "pending-remove") {
        const pluginRoot = path.join(config.pluginsDir, pluginId);
        const dataDir = pluginDataDir(config.pluginsDir, pluginId, path.join);
        const markerPath = path.join(pluginRoot, PRESERVE_DATA_MARKER);
        const preserveData = yield* fs.exists(markerPath).pipe(Effect.orElseSucceed(() => false));
        const preservedDataDir = path.join(
          config.pluginsDir,
          `.preserved-${pluginId}-${yield* clock.currentTimeMillis}`,
        );
        if (preserveData && (yield* fs.exists(dataDir).pipe(Effect.orElseSucceed(() => false)))) {
          yield* fs.rename(dataDir, preservedDataDir);
        }
        yield* fs.remove(pluginRoot, { recursive: true, force: true });
        if (
          preserveData &&
          (yield* fs.exists(preservedDataDir).pipe(Effect.orElseSucceed(() => false)))
        ) {
          yield* fs.makeDirectory(pluginRoot, { recursive: true });
          yield* fs.rename(preservedDataDir, dataDir);
        }
        yield* store.removePlugin(pluginId);
        return false;
      }
      if (entry.state === "pending-upgrade") {
        if (!entry.staged) {
          yield* markFailure(pluginId, "pending upgrade is missing staged plugin metadata");
          return false;
        }
        const staged = entry.staged;
        yield* store
          .updatePlugin(pluginId, ({ current }) =>
            Effect.succeed(current ? upgradeLockfileEntry(current, staged) : undefined),
          )
          .pipe(Effect.tap(() => publishPluginStateChanged(pluginId, "active")));
        return true;
      }
      if (entry.activation.activatingSince !== null) {
        const crashCount = entry.activation.crashCount + 1;
        if (crashCount >= 2) {
          yield* store
            .updatePlugin(pluginId, ({ current }) =>
              Effect.succeed(
                current
                  ? {
                      ...current,
                      state: "failed",
                      lastError: "disabled after repeated crashes",
                      activation: { activatingSince: null, crashCount },
                    }
                  : undefined,
              ),
            )
            .pipe(Effect.tap(() => publishPluginStateChanged(pluginId, "failed")));
          return false;
        }
        yield* store.updatePlugin(pluginId, ({ current }) =>
          Effect.succeed(
            current
              ? {
                  ...current,
                  activation: { activatingSince: null, crashCount },
                }
              : undefined,
          ),
        );
      }
      return true;
    });

  const start = Effect.gen(function* () {
    if (process.env.T3_NO_PLUGINS === "1") {
      yield* Effect.logInfo("Plugin host disabled by T3_NO_PLUGINS");
      return;
    }
    if (!(yield* fs.exists(store.lockfilePath).pipe(Effect.orElseSucceed(() => false)))) {
      return;
    }
    yield* loader.ensureHostSingletonResolution;
    const lockfile = yield* store.readLockfile.pipe(
      Effect.catch((error) =>
        Effect.logWarning("Plugin host could not read lockfile", {
          path: store.lockfilePath,
          error: error.message,
        }).pipe(Effect.as({ plugins: {}, sources: [] })),
      ),
    );

    for (const [rawPluginId, entry] of Object.entries(lockfile.plugins)) {
      const pluginId = rawPluginId as PluginId;
      const shouldContinue = yield* reconcilePendingState(pluginId, entry).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Plugin pending-state reconciliation failed", {
            pluginId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(false)),
        ),
      );
      if (!shouldContinue || !entry.enabled) continue;
      const currentLockfile = yield* store.readLockfile.pipe(Effect.orElseSucceed(() => lockfile));
      const currentEntry = getLockfilePlugin(currentLockfile, pluginId);
      if (!currentEntry?.enabled || currentEntry.state !== "active") continue;
      yield* loadPlugin(pluginId, currentEntry).pipe(
        Effect.catchCause((cause) =>
          // A per-plugin self-cancel (the pre-put state re-check firing the typed
          // PluginActivationCanceled sentinel for ONE plugin) is benign: log and
          // CONTINUE so the remaining plugins still activate. Everything else goes
          // through handleLoadFailureCause, which RE-RAISES a genuine interrupt-
          // only cause (host shutdown) — that propagates out of this loop so the
          // trailing Effect.ignoreCause ends start promptly instead of plodding
          // through the rest of the plugins during shutdown — and marks a real
          // error as "failed".
          causeHasActivationCanceled(cause)
            ? Effect.logWarning("Plugin activation canceled during start; skipping", {
                pluginId,
                cause: Cause.pretty(cause),
              })
            : handleLoadFailureCause(
                pluginId,
                "Plugin activation failed before scope acquisition",
                cause,
              ),
        ),
      );
    }
  }).pipe(Effect.ignoreCause({ log: true }));

  return PluginHost.of({ start, activatePlugin, deactivatePlugin });
});

export const layer = Layer.effect(PluginHost, make());
