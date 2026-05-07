import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as EffectPath from "effect/Path";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { ipcMain, type MenuItemConstructorOptions, Menu } from "electron";

import * as NetService from "@t3tools/shared/Net";
import { parsePersistedServerObservabilitySettings } from "@t3tools/shared/serverSettings";
import type { RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import { resolveRemoteT3CliPackageSpec } from "@t3tools/ssh/command";

import { DEFAULT_DESKTOP_BACKEND_PORT, resolveDesktopBackendPortEffect } from "./backendPort.ts";
import { type DesktopSettings } from "./desktopSettings.ts";
import {
  DesktopBackendConfiguration,
  DesktopBackendEvents,
  DesktopBackendManager,
  DesktopBackendManagerLive,
  DesktopBackendProcessRunnerLive,
  type DesktopBackendManagerShape,
  type DesktopBackendStartConfig,
} from "./desktopBackendManager.ts";
import * as DesktopNetworkInterfaces from "./desktopNetworkInterfaces.ts";
import {
  DesktopBackendOutputLog,
  DesktopBackendOutputLogLive,
  DesktopLoggerLive,
} from "./desktopLogger.ts";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
  type DesktopEnvironmentShape,
} from "./desktopEnvironment.ts";
import * as DesktopSecretStorage from "./electron/ElectronSafeStorage.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronMenu from "./electron/ElectronMenu.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as ElectronTheme from "./electron/ElectronTheme.ts";
import * as ElectronUpdater from "./electron/ElectronUpdater.ts";
import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import { DesktopShutdown, makeDesktopShutdown } from "./desktopShutdown.ts";
import { installDesktopIpcHandlers } from "./ipc/DesktopIpcHandlers.ts";
import { DesktopServerExposureIpcActions } from "./ipc/methods/serverExposure.ts";
import { DesktopUpdateIpcActions } from "./ipc/methods/updates.ts";
import * as DesktopWindowIpcActionsLive from "./ipc/methods/windowLive.ts";
import {
  DesktopShellEnvironment,
  DesktopShellEnvironmentConfigLive,
  DesktopShellEnvironmentLive,
  DesktopShellEnvironmentProbeLive,
} from "./syncShellEnvironment.ts";
import * as DesktopAssets from "./main/DesktopAssets.ts";
import { formatErrorMessage } from "./main/DesktopErrors.ts";
import * as DesktopLifecycle from "./main/DesktopLifecycle.ts";
import * as DesktopLocalEnvironment from "./main/DesktopLocalEnvironment.ts";
import * as DesktopServerExposure from "./main/DesktopServerExposure.ts";
import * as DesktopSettingsState from "./main/DesktopSettingsState.ts";
import * as DesktopSshEnvironment from "./main/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "./main/DesktopSshPasswordPrompts.ts";
import * as DesktopSshRemoteApi from "./main/DesktopSshRemoteApi.ts";
import * as DesktopState from "./main/DesktopState.ts";
import * as DesktopUpdates from "./main/DesktopUpdates.ts";
import * as DesktopWindow from "./main/DesktopWindow.ts";

const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;
const AppPackageMetadata = Schema.Struct({
  t3codeCommitHash: Schema.optional(Schema.String),
});
interface BackendObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}
let backendBootstrapToken = "";
let aboutCommitHashCache: Option.Option<string> | undefined;
let appRunId = "startup";
let backendObservabilitySettings: BackendObservabilitySettings = {
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
};

interface DesktopEffectRunner {
  <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A>;
}

type DesktopWindowBoundaryServices =
  | ElectronDialog.ElectronDialog
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow;

function makeDesktopEffectRunner<R>(context: Context.Context<R>): DesktopEffectRunner {
  return <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.runPromiseWith(context as unknown as Context.Context<R2>)(effect);
}

const withDesktopLogAnnotations = (
  effect: Effect.Effect<void>,
  annotations?: Record<string, unknown>,
): Effect.Effect<void> =>
  effect.pipe(
    Effect.annotateLogs({
      scope: "desktop",
      runId: appRunId,
      ...annotations,
    }),
  );

const logDesktopInfo = (
  message: string,
  annotations?: Record<string, unknown>,
): Effect.Effect<void> => withDesktopLogAnnotations(Effect.logInfo(message), annotations);

const logDesktopWarning = (
  message: string,
  annotations?: Record<string, unknown>,
): Effect.Effect<void> => withDesktopLogAnnotations(Effect.logWarning(message), annotations);

const logDesktopError = (
  message: string,
  annotations?: Record<string, unknown>,
): Effect.Effect<void> => withDesktopLogAnnotations(Effect.logError(message), annotations);

const logUpdaterInfo = (
  message: string,
  annotations?: Record<string, unknown>,
): Effect.Effect<void> =>
  withDesktopLogAnnotations(Effect.logInfo(message), {
    component: "desktop-updater",
    ...annotations,
  });

function readPersistedBackendObservabilitySettings(): Effect.Effect<
  BackendObservabilitySettings,
  never,
  FileSystem.FileSystem | DesktopEnvironment
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = yield* DesktopEnvironment;
    const exists = yield* fileSystem
      .exists(environment.serverSettingsPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
    }

    const raw = yield* fileSystem
      .readFileString(environment.serverSettingsPath)
      .pipe(Effect.option);
    if (Option.isNone(raw)) {
      yield* logDesktopWarning("failed to read persisted backend observability settings");
      return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
    }

    return yield* Effect.try({
      try: () => parsePersistedServerObservabilitySettings(raw.value),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        logDesktopWarning("failed to parse persisted backend observability settings", {
          error,
        }).pipe(Effect.as({ otlpTracesUrl: undefined, otlpMetricsUrl: undefined })),
      ),
    );
  });
}

function resolveConfiguredDesktopBackendPort(rawPort: string | undefined): number | undefined {
  if (!rawPort) {
    return undefined;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    return undefined;
  }

  return parsedPort;
}

function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.T3CODE_PORT;
  delete env.T3CODE_MODE;
  delete env.T3CODE_NO_BROWSER;
  delete env.T3CODE_HOST;
  delete env.T3CODE_DESKTOP_WS_URL;
  delete env.T3CODE_DESKTOP_LAN_ACCESS;
  delete env.T3CODE_DESKTOP_LAN_HOST;
  delete env.T3CODE_DESKTOP_HTTPS_ENDPOINTS;
  delete env.T3CODE_TAILSCALE_SERVE;
  delete env.T3CODE_TAILSCALE_SERVE_PORT;
  return env;
}

function relaunchDesktopAppEffect(
  reason: string,
): Effect.Effect<
  void,
  never,
  ElectronApp.ElectronApp | DesktopEnvironment | DesktopShutdown | DesktopState.DesktopState
> {
  return Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const environment = yield* DesktopEnvironment;
    const state = yield* DesktopState.DesktopState;
    const context = yield* Effect.context<
      ElectronApp.ElectronApp | DesktopEnvironment | DesktopShutdown | DesktopState.DesktopState
    >();
    const runEffect = makeDesktopEffectRunner(context);
    yield* logDesktopInfo("desktop relaunch requested", { reason });
    yield* Effect.sync(() => {
      setImmediate(() => {
        void runEffect(
          Ref.set(state.quitting, true).pipe(Effect.andThen(requestDesktopShutdownAndWait())),
        ).finally(() => {
          if (environment.isDevelopment) {
            void runEffect(electronApp.exit(75));
            return;
          }
          void runEffect(
            electronApp
              .relaunch({
                execPath: process.execPath,
                args: process.argv.slice(1),
              })
              .pipe(Effect.andThen(electronApp.exit(0))),
          );
        });
      });
    });
  });
}

const resolveBackendStartConfig: Effect.Effect<
  DesktopBackendStartConfig,
  never,
  FileSystem.FileSystem | DesktopEnvironment | DesktopServerExposure.DesktopServerExposure
> = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment;
  const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
  const backendExposure = yield* serverExposure.backendConfig;
  backendObservabilitySettings = yield* readPersistedBackendObservabilitySettings();
  const captureBackendLogs = !environment.isDevelopment;

  return {
    executablePath: process.execPath,
    entryPath: environment.backendEntryPath,
    cwd: environment.backendCwd,
    env: {
      ...backendChildEnv(),
      ELECTRON_RUN_AS_NODE: "1",
    },
    bootstrap: {
      mode: "desktop",
      noBrowser: true,
      port: backendExposure.port,
      t3Home: environment.baseDir,
      host: backendExposure.bindHost,
      desktopBootstrapToken: backendBootstrapToken,
      tailscaleServeEnabled: backendExposure.tailscaleServeEnabled,
      tailscaleServePort: backendExposure.tailscaleServePort,
      ...(backendObservabilitySettings.otlpTracesUrl
        ? { otlpTracesUrl: backendObservabilitySettings.otlpTracesUrl }
        : {}),
      ...(backendObservabilitySettings.otlpMetricsUrl
        ? { otlpMetricsUrl: backendObservabilitySettings.otlpMetricsUrl }
        : {}),
    },
    httpBaseUrl: backendExposure.httpBaseUrl,
    captureOutput: captureBackendLogs,
  };
});

const randomHexString = (length: number): Effect.Effect<string> =>
  Effect.gen(function* () {
    let value = "";
    while (value.length < length) {
      value += (yield* Random.nextUUIDv4).replace(/-/g, "");
    }
    return value.slice(0, length);
  });

const desktopEnvironmentLayer = Layer.effect(
  DesktopEnvironment,
  Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const metadata = yield* electronApp.metadata;
    return yield* makeDesktopEnvironment({
      dirname: __dirname,
      env: process.env,
      cwd: process.cwd(),
      platform: process.platform,
      processArch: process.arch,
      ...metadata,
    });
  }),
).pipe(Layer.provide(Layer.mergeAll(EffectPath.layer, ElectronApp.layer)));

const desktopLoggerLayer = DesktopLoggerLive.pipe(Layer.provide(NodeServices.layer));

const desktopBackendOutputLogLayer = DesktopBackendOutputLogLive.pipe(
  Layer.provide(NodeServices.layer),
);

const desktopBackendConfigurationLayer = Layer.effect(
  DesktopBackendConfiguration,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    return {
      resolve: resolveBackendStartConfig.pipe(
        Effect.provideService(DesktopEnvironment, environment),
        Effect.provideService(DesktopServerExposure.DesktopServerExposure, serverExposure),
      ),
    };
  }),
);
const desktopBackendEventsLayer = Layer.effect(
  DesktopBackendEvents,
  Effect.gen(function* () {
    const backendOutputLog = yield* DesktopBackendOutputLog;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const state = yield* DesktopState.DesktopState;

    return {
      onStarting: Ref.set(state.backendReady, false),
      onStarted: ({ pid, config }) =>
        backendOutputLog.writeSessionBoundary({
          phase: "START",
          runId: appRunId,
          details: `pid=${pid} port=${config.bootstrap.port} cwd=${config.cwd}`,
        }),
      onReady: desktopWindow.handleBackendReady.pipe(
        Effect.catch((error) =>
          logDesktopError("failed to open main window after backend readiness", {
            message: error.message,
          }),
        ),
      ),
      onReadinessFailure: (error) =>
        logDesktopWarning("backend readiness check failed during bootstrap", {
          error: formatErrorMessage(error),
        }),
      onOutput: (streamName, chunk) => backendOutputLog.writeOutputChunk(streamName, chunk),
      onExit: ({ pid, reason }) =>
        Effect.gen(function* () {
          yield* Option.match(pid, {
            onNone: () => Effect.void,
            onSome: (value) =>
              backendOutputLog.writeSessionBoundary({
                phase: "END",
                runId: appRunId,
                details: `pid=${value} ${reason}`,
              }),
          });
          yield* Ref.set(state.backendReady, false);
        }),
      onRestartScheduled: ({ reason, delay }) =>
        logDesktopError("backend exited unexpectedly; restart scheduled", {
          reason,
          delayMs: Duration.toMillis(delay),
        }),
    };
  }),
);

function resolveDesktopSshCliRunner(
  environment: DesktopEnvironmentShape,
  settings: DesktopSettings,
): RemoteT3RunnerOptions {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteT3ServerEntryPath);
  if (environment.isDevelopment && devRemoteEntryPath !== undefined) {
    return { nodeScriptPath: devRemoteEntryPath };
  }
  return {
    packageSpec: resolveRemoteT3CliPackageSpec({
      appVersion: environment.appVersion,
      updateChannel: settings.updateChannel,
      isDevelopment: environment.isDevelopment,
    }),
  };
}

const desktopSshEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    const settingsState = yield* DesktopSettingsState.DesktopSettingsState;
    return DesktopSshEnvironment.layer({
      resolveCliRunner: settingsState.get.pipe(
        Effect.map((settings) => resolveDesktopSshCliRunner(environment, settings)),
      ),
    });
  }),
);

const desktopSshRuntimeLayer = Layer.mergeAll(
  desktopSshEnvironmentLayer,
  DesktopSshRemoteApi.layer,
).pipe(Layer.provideMerge(DesktopSshPasswordPrompts.layer()), Layer.provideMerge(NetService.layer));

const desktopShellEnvironmentProbeLayer = DesktopShellEnvironmentProbeLive.pipe(
  Layer.provide(NodeServices.layer),
);

const desktopShellEnvironmentLayer = DesktopShellEnvironmentLive.pipe(
  Layer.provide(
    Layer.mergeAll(DesktopShellEnvironmentConfigLive, desktopShellEnvironmentProbeLayer),
  ),
);

const desktopServerExposureLayer = DesktopServerExposure.layer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(DesktopNetworkInterfaces.layer),
  Layer.provideMerge(DesktopSettingsState.layer),
  Layer.provideMerge(desktopEnvironmentLayer),
);

type DesktopServerExposureIpcActionServices =
  | ElectronApp.ElectronApp
  | DesktopEnvironment
  | DesktopState.DesktopState;

const desktopServerExposureIpcActionsLayer = Layer.effect(
  DesktopServerExposureIpcActions,
  Effect.gen(function* () {
    const context = yield* Effect.context<DesktopServerExposureIpcActionServices>();
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    return DesktopServerExposureIpcActions.of({
      getState: serverExposure.getState,
      setMode: (nextMode) =>
        Effect.gen(function* () {
          const change = yield* serverExposure.setMode(nextMode);
          if (change.requiresRelaunch) {
            yield* relaunchDesktopAppEffect(`serverExposureMode=${nextMode}`);
          }
          return change.state;
        }).pipe(Effect.provide(context)),
      setTailscaleServeEnabled: (input) =>
        Effect.gen(function* () {
          const change = yield* serverExposure.setTailscaleServeEnabled(input);
          if (change.requiresRelaunch) {
            yield* relaunchDesktopAppEffect(
              change.state.tailscaleServeEnabled
                ? "tailscale-serve-enabled"
                : "tailscale-serve-disabled",
            );
          }
          return change.state;
        }).pipe(Effect.provide(context)),
      getAdvertisedEndpoints: serverExposure.getAdvertisedEndpoints,
    });
  }),
);

const desktopUpdatesLayer = DesktopUpdates.layer.pipe(Layer.provideMerge(ElectronUpdater.layer));

const desktopAssetsLayer = DesktopAssets.layer;

const desktopWindowLayer = DesktopWindow.layer.pipe(Layer.provideMerge(desktopAssetsLayer));

const desktopUpdateIpcActionsLayer = Layer.effect(
  DesktopUpdateIpcActions,
  Effect.gen(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    return DesktopUpdateIpcActions.of({
      getState: updates.getState,
      setChannel: updates.setChannel,
      download: updates.download,
      install: updates.install,
      check: updates.check("web-ui"),
    });
  }),
).pipe(Layer.provideMerge(desktopUpdatesLayer));

const desktopBackendDependenciesLayer = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerUndici,
  NetService.layer,
  DesktopBackendProcessRunnerLive,
  desktopBackendConfigurationLayer,
  desktopBackendEventsLayer.pipe(
    Layer.provide(desktopBackendOutputLogLayer),
    Layer.provide(desktopWindowLayer),
  ),
);

const desktopBackendManagerLayer = DesktopBackendManagerLive.pipe(
  Layer.provide(desktopBackendDependenciesLayer),
);

const desktopBackendRuntimeLayer = DesktopLocalEnvironment.layer.pipe(
  Layer.provideMerge(desktopBackendManagerLayer),
  Layer.provideMerge(desktopServerExposureLayer),
);

const desktopRuntimeLayer = Layer.mergeAll(
  desktopLoggerLayer,
  desktopShellEnvironmentLayer,
  desktopSshRuntimeLayer,
  DesktopLifecycle.layer,
  desktopWindowLayer,
  Layer.succeed(DesktopIpc.DesktopIpc, DesktopIpc.make(ipcMain)),
  desktopServerExposureIpcActionsLayer,
  desktopUpdateIpcActionsLayer,
  DesktopWindowIpcActionsLive.layer,
  DesktopSecretStorage.layer,
).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(DesktopNetworkInterfaces.layer),
  Layer.provideMerge(desktopBackendRuntimeLayer),
  Layer.provideMerge(ElectronWindow.layer),
  Layer.provideMerge(ElectronApp.layer),
  Layer.provideMerge(ElectronDialog.layer),
  Layer.provideMerge(ElectronMenu.layer),
  Layer.provideMerge(ElectronProtocol.layer),
  Layer.provideMerge(ElectronShell.layer),
  Layer.provideMerge(ElectronTheme.layer),
  Layer.provideMerge(desktopEnvironmentLayer),
);

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
}

function resolveEmbeddedCommitHashEffect(): Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | DesktopEnvironment
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = yield* DesktopEnvironment;
    const packageJsonPath = environment.path.join(environment.appRoot, "package.json");
    const raw = yield* fileSystem.readFileString(packageJsonPath).pipe(Effect.option);
    return yield* Option.match(raw, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (value) =>
        Schema.decodeEffect(Schema.fromJsonString(AppPackageMetadata))(value).pipe(
          Effect.map((parsed) =>
            Option.fromNullishOr(normalizeCommitHash(parsed.t3codeCommitHash)),
          ),
          Effect.catch(() => Effect.succeed(Option.none<string>())),
        ),
    });
  });
}

function resolveAboutCommitHash(): Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | DesktopEnvironment
> {
  if (aboutCommitHashCache !== undefined) {
    return Effect.succeed(aboutCommitHashCache);
  }

  const envCommitHash = normalizeCommitHash(process.env.T3CODE_COMMIT_HASH);
  if (envCommitHash) {
    aboutCommitHashCache = Option.some(envCommitHash);
    return Effect.succeed(aboutCommitHashCache);
  }

  // Only packaged builds are required to expose commit metadata.
  return Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    if (!environment.isPackaged) {
      aboutCommitHashCache = Option.none();
      return aboutCommitHashCache;
    }

    return yield* resolveEmbeddedCommitHashEffect().pipe(
      Effect.tap((commitHash) =>
        Effect.sync(() => {
          aboutCommitHashCache = commitHash;
        }),
      ),
    );
  });
}

function handleFatalStartupError(
  stage: string,
  error: unknown,
): Effect.Effect<
  void,
  never,
  | DesktopShutdown
  | DesktopState.DesktopState
  | ElectronApp.ElectronApp
  | ElectronDialog.ElectronDialog
> {
  return Effect.gen(function* () {
    const shutdown = yield* DesktopShutdown;
    const state = yield* DesktopState.DesktopState;
    const electronApp = yield* ElectronApp.ElectronApp;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const message = formatErrorMessage(error);
    const detail =
      error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
    yield* logDesktopError("fatal startup error", {
      stage,
      message,
      ...(detail.length > 0 ? { detail } : {}),
    });
    const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
    if (!wasQuitting) {
      yield* electronDialog.showErrorBox(
        "T3 Code failed to start",
        `Stage: ${stage}\n${message}${detail}`,
      );
    }
    yield* shutdown.request;
    yield* electronApp.quit;
  });
}

function registerDesktopProtocol(): Effect.Effect<
  void,
  unknown,
  FileSystem.FileSystem | DesktopEnvironment | ElectronProtocol.ElectronProtocol | Scope.Scope
> {
  return Effect.gen(function* () {
    const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
    yield* electronProtocol.registerDesktopFileProtocol;
  });
}

function dispatchMenuAction(
  action: string,
): Effect.Effect<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  return Effect.gen(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.dispatchMenuAction(action);
  });
}

function handleCheckForUpdatesMenuClick(): Effect.Effect<
  void,
  DesktopWindow.DesktopWindowError,
  DesktopUpdates.DesktopUpdates | ElectronDialog.ElectronDialog | DesktopWindow.DesktopWindow
> {
  return Effect.gen(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const disabledReason = yield* updates.disabledReason;
    if (Option.isSome(disabledReason)) {
      yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
        disabledReason: disabledReason.value,
      });
      yield* electronDialog.showMessageBox({
        type: "info",
        title: "Updates unavailable",
        message: "Automatic updates are not available right now.",
        detail: disabledReason.value,
        buttons: ["OK"],
      });
      return;
    }

    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.ensureMain;
    yield* checkForUpdatesFromMenu();
  });
}

function checkForUpdatesFromMenu(): Effect.Effect<
  void,
  never,
  DesktopUpdates.DesktopUpdates | ElectronDialog.ElectronDialog
> {
  return Effect.gen(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const result = yield* updates.check("menu");
    const updateState = result.state;

    if (updateState.status === "up-to-date") {
      yield* electronDialog.showMessageBox({
        type: "info",
        title: "You're up to date!",
        message: `T3 Code ${updateState.currentVersion} is currently the newest version available.`,
        buttons: ["OK"],
      });
    } else if (updateState.status === "error") {
      yield* electronDialog.showMessageBox({
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: updateState.message ?? "An unknown error occurred. Please try again later.",
        buttons: ["OK"],
      });
    }
  });
}

function configureApplicationMenu(): Effect.Effect<
  void,
  never,
  ElectronApp.ElectronApp | DesktopWindowBoundaryServices
> {
  return Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const appName = yield* electronApp.name;
    const context = yield* Effect.context<
      ElectronApp.ElectronApp | DesktopWindowBoundaryServices
    >();
    const runEffect = makeDesktopEffectRunner(context);
    const template: MenuItemConstructorOptions[] = [];

    if (process.platform === "darwin") {
      template.push({
        label: appName,
        submenu: [
          { role: "about" },
          {
            label: "Check for Updates...",
            click: () => {
              void runEffect(handleCheckForUpdatesMenuClick());
            },
          },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: () => {
              void runEffect(dispatchMenuAction("open-settings"));
            },
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: "File",
        submenu: [
          ...(process.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  accelerator: "CmdOrCtrl+,",
                  click: () => {
                    void runEffect(dispatchMenuAction("open-settings"));
                  },
                },
                { type: "separator" as const },
              ]),
          { role: process.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Check for Updates...",
            click: () => {
              void runEffect(handleCheckForUpdatesMenuClick());
            },
          },
        ],
      },
    );

    yield* Effect.sync(() => {
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    });
  });
}

/**
 * Resolve the Electron userData directory path.
 *
 * Electron derives the default userData path from `productName` in
 * package.json, which currently produces directories with spaces and
 * parentheses (e.g. `~/.config/T3 Code (Alpha)` on Linux). This is
 * unfriendly for shell usage and violates Linux naming conventions.
 *
 * We override it to a clean lowercase name (`t3code`). If the legacy
 * directory already exists we keep using it so existing users don't
 * lose their Chromium profile data (localStorage, cookies, sessions).
 */
function resolveUserDataPath(): Effect.Effect<
  string,
  never,
  FileSystem.FileSystem | DesktopEnvironment
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = yield* DesktopEnvironment;
    const appDataBase =
      process.platform === "win32"
        ? process.env.APPDATA ||
          environment.path.join(environment.homeDirectory, "AppData", "Roaming")
        : process.platform === "darwin"
          ? environment.path.join(environment.homeDirectory, "Library", "Application Support")
          : process.env.XDG_CONFIG_HOME ||
            environment.path.join(environment.homeDirectory, ".config");
    const legacyPath = environment.path.join(appDataBase, environment.legacyUserDataDirName);
    const legacyPathExists = yield* fileSystem
      .exists(legacyPath)
      .pipe(Effect.orElseSucceed(() => false));
    return legacyPathExists
      ? legacyPath
      : environment.path.join(appDataBase, environment.userDataDirName);
  });
}

function configureAppIdentity(): Effect.Effect<
  void,
  never,
  FileSystem.FileSystem | ElectronApp.ElectronApp | DesktopEnvironment | DesktopAssets.DesktopAssets
> {
  return Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const environment = yield* DesktopEnvironment;
    const assets = yield* DesktopAssets.DesktopAssets;
    const commitHash = yield* resolveAboutCommitHash();
    yield* electronApp.setName(environment.displayName);
    yield* electronApp.setAboutPanelOptions({
      applicationName: environment.displayName,
      applicationVersion: environment.appVersion,
      version: Option.getOrElse(commitHash, () => "unknown"),
    });

    if (process.platform === "win32") {
      yield* electronApp.setAppUserModelId(environment.appUserModelId);
    }

    if (process.platform === "linux") {
      yield* electronApp.setDesktopName(environment.linuxDesktopEntryName);
    }

    if (process.platform === "darwin") {
      const iconPaths = yield* assets.iconPaths;
      yield* Option.match(iconPaths.png, {
        onNone: () => Effect.void,
        onSome: electronApp.setDockIcon,
      });
    }
  });
}

function startBackend(): Effect.Effect<
  void,
  never,
  DesktopBackendManager | DesktopState.DesktopState
> {
  return Effect.gen(function* () {
    const state = yield* DesktopState.DesktopState;
    if (yield* Ref.get(state.quitting)) return;
    const backendManager = yield* DesktopBackendManager;
    yield* backendManager.start;
  }).pipe(
    Effect.catchCause((cause) =>
      logDesktopError("failed to start backend", {
        cause: Cause.pretty(cause),
      }),
    ),
  );
}

function closeDesktopResourcesWithManager(
  backendManager: DesktopBackendManagerShape,
  updates: DesktopUpdates.DesktopUpdatesShape,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* backendManager.shutdown;
    yield* updates.shutdown;
  });
}

function requestDesktopShutdownAndWait(): Effect.Effect<void, never, DesktopShutdown> {
  return Effect.gen(function* () {
    const shutdown = yield* DesktopShutdown;
    yield* shutdown.request;
    yield* shutdown.awaitComplete;
  });
}

function bootstrap() {
  return Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const settingsState = yield* DesktopSettingsState.DesktopSettingsState;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    yield* logDesktopInfo("bootstrap start");
    const configuredBackendPort = resolveConfiguredDesktopBackendPort(process.env.T3CODE_PORT);
    if (environment.isDevelopment && configuredBackendPort === undefined) {
      return yield* Effect.fail(new Error("T3CODE_PORT is required in desktop development."));
    }

    const backendPort =
      configuredBackendPort ??
      (yield* resolveDesktopBackendPortEffect({
        host: DesktopServerExposure.DESKTOP_LOOPBACK_HOST,
        startPort: DEFAULT_DESKTOP_BACKEND_PORT,
        requiredHosts: DesktopServerExposure.DESKTOP_REQUIRED_PORT_PROBE_HOSTS,
      }));
    yield* logDesktopInfo(
      configuredBackendPort === undefined
        ? "selected backend port via sequential scan"
        : "using configured backend port",
      {
        port: backendPort,
        ...(configuredBackendPort === undefined ? { startPort: DEFAULT_DESKTOP_BACKEND_PORT } : {}),
      },
    );
    backendBootstrapToken = yield* randomHexString(48);
    const settings = yield* settingsState.get;
    if (settings.serverExposureMode !== environment.defaultDesktopSettings.serverExposureMode) {
      yield* logDesktopInfo("bootstrap restoring persisted server exposure mode", {
        mode: settings.serverExposureMode,
      });
    }
    const serverExposureState = yield* serverExposure.configureFromSettings({ port: backendPort });
    const backendConfig = yield* serverExposure.backendConfig;
    yield* logDesktopInfo("bootstrap resolved backend endpoint", {
      baseUrl: backendConfig.httpBaseUrl.href,
    });
    if (serverExposureState.endpointUrl) {
      yield* logDesktopInfo("bootstrap enabled network access", {
        endpointUrl: serverExposureState.endpointUrl,
      });
    } else if (settings.serverExposureMode === "network-accessible") {
      yield* logDesktopWarning(
        "bootstrap fell back to local-only because no advertised network host was available",
      );
    }

    yield* installDesktopIpcHandlers;
    yield* logDesktopInfo("bootstrap ipc handlers registered");
    yield* startBackend();
    yield* logDesktopInfo("bootstrap backend start requested");

    if (environment.isDevelopment) {
      yield* desktopWindow.ensureMain;
    }
  });
}

function fatalStartupCause(stage: string, cause: Cause.Cause<unknown>) {
  return handleFatalStartupError(stage, new Error(Cause.pretty(cause))).pipe(
    Effect.andThen(Effect.failCause(cause)),
  );
}

const waitForElectronReady = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  yield* electronApp.whenReady;
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const shutdown = yield* makeDesktopShutdown;

    yield* Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
      yield* electronProtocol.registerDesktopSchemePrivileges;

      const environment = yield* DesktopEnvironment;
      appRunId = (yield* Random.nextUUIDv4).replace(/-/g, "").slice(0, 12);
      const backendManager = yield* DesktopBackendManager;
      const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
      const shellEnvironment = yield* DesktopShellEnvironment;
      const settingsState = yield* DesktopSettingsState.DesktopSettingsState;
      const updates = yield* DesktopUpdates.DesktopUpdates;
      yield* Scope.addFinalizer(
        yield* Scope.Scope,
        closeDesktopResourcesWithManager(backendManager, updates).pipe(
          Effect.ensuring(shutdown.markComplete),
        ),
      );

      yield* shellEnvironment.sync;
      const userDataPath = yield* resolveUserDataPath();
      // Must happen before Electron's ready event so Chromium profile data
      // lands in the desktop-specific userData directory.
      yield* electronApp.setPath("userData", userDataPath);
      yield* logDesktopInfo("runtime logging configured", { logDir: environment.logDir });
      yield* settingsState.load;

      if (process.platform === "linux") {
        yield* electronApp.appendCommandLineSwitch("class", environment.linuxWmClass);
      }

      yield* configureAppIdentity();
      yield* lifecycle.register;

      yield* waitForElectronReady.pipe(
        Effect.catchCause((cause) => fatalStartupCause("whenReady", cause)),
      );
      yield* logDesktopInfo("app ready");
      yield* configureAppIdentity();
      yield* configureApplicationMenu();
      yield* registerDesktopProtocol();
      yield* updates.configure;
      yield* bootstrap().pipe(Effect.catchCause((cause) => fatalStartupCause("bootstrap", cause)));
      yield* shutdown.awaitRequest;
    }).pipe(Effect.provideService(DesktopShutdown, shutdown));
  }),
).pipe(
  Effect.catchCause((cause) =>
    logDesktopError("desktop main fiber failed", {
      cause: Cause.pretty(cause),
    }),
  ),
);

program.pipe(
  Effect.provide(desktopRuntimeLayer),
  Effect.provide(DesktopState.layer),
  NodeRuntime.runMain,
);
