/**
 * Opt-in anonymous PostHog telemetry service.
 *
 * When enabled, persists an installation-scoped anonymous identifier, buffers
 * events in memory, and flushes batches over Effect's HTTP client.
 *
 * @module AnalyticsService
 */
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import { getTelemetryIdentifier } from "./Identify.ts";

interface BufferedAnalyticsEvent {
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.string("T3CODE_POSTHOG_KEY").pipe(
    Config.withDefault("phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m"),
  ),
  posthogHost: Config.string("T3CODE_POSTHOG_HOST").pipe(
    Config.withDefault("https://us.i.posthog.com"),
  ),
  telemetryEnvEnabled: Config.boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.option),
  flushBatchSize: Config.number("T3CODE_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.number("T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
  wslDistroName: Config.string("WSL_DISTRO_NAME").pipe(Config.option),
});

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Record an anonymous event for best-effort buffered delivery. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;

    /** Flush all currently queued telemetry events. */
    readonly flush: Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {
  /** No-op layer for callers that intentionally disable telemetry. */
  static readonly layerTest = Layer.succeed(
    AnalyticsService,
    AnalyticsService.of({
      record: () => Effect.void,
      flush: Effect.void,
    }),
  );
}

export const make = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig;

  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";
  const hostPlatform = yield* HostProcessPlatform;
  const hostArchitecture = yield* HostProcessArchitecture;

  yield* serverSettings.start.pipe(
    Effect.catch((cause) =>
      Effect.logDebug("Failed to start telemetry settings watcher", { cause }),
    ),
  );

  const telemetryEnvEnabled = telemetryConfig.telemetryEnvEnabled;
  const telemetryEnvExplicitlyDisabled =
    Option.isSome(telemetryEnvEnabled) && telemetryEnvEnabled.value === false;

  if (Option.isSome(telemetryEnvEnabled) && telemetryEnvEnabled.value === true) {
    yield* serverSettings.getSettings.pipe(
      Effect.flatMap((settings) =>
        settings.telemetryPreferenceSet || settings.telemetryEnabled
          ? Effect.void
          : serverSettings
              .updateSettings({ telemetryEnabled: true, telemetryPreferenceSet: true })
              .pipe(Effect.asVoid),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to seed telemetry setting from environment", { cause }),
      ),
    );
  }

  const isTelemetryEnabled = Effect.fn("isTelemetryEnabled")(function* () {
    if (telemetryEnvExplicitlyDisabled) {
      return false;
    }
    return yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.telemetryEnabled),
    );
  });
  const resolveTelemetryIdentifier = getTelemetryIdentifier.pipe(
    Effect.provideService(Crypto.Crypto, crypto),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
    Effect.provideService(ServerConfig.ServerConfig, serverConfig),
  );

  const enqueueBufferedEvent = (event: string, properties?: Readonly<Record<string, unknown>>) =>
    Effect.flatMap(DateTime.now, (now) =>
      Ref.modify(bufferRef, (current) => {
        const appended = [
          ...current,
          {
            event,
            ...(properties ? { properties } : {}),
            capturedAt: DateTime.formatIso(now),
          } satisfies BufferedAnalyticsEvent,
        ];

        const next =
          appended.length > telemetryConfig.maxBufferedEvents
            ? appended.slice(appended.length - telemetryConfig.maxBufferedEvents)
            : appended;

        return [
          {
            size: next.length,
            dropped: next.length !== appended.length,
          } as const,
          next,
        ] as const;
      }),
    );

  const sendBatch = Effect.fn("AnalyticsService.sendBatch")(function* (
    events: ReadonlyArray<BufferedAnalyticsEvent>,
  ) {
    if (!(yield* isTelemetryEnabled())) {
      return;
    }

    const identifier = yield* resolveTelemetryIdentifier;
    if (!identifier) {
      yield* Effect.logDebug("Skipping telemetry batch; identifier unavailable");
      return;
    }

    const payload = {
      api_key: telemetryConfig.posthogKey,
      batch: events.map((event) => ({
        event: event.event,
        distinct_id: identifier,
        properties: {
          ...event.properties,
          $process_person_profile: false,
          platform: hostPlatform,
          wsl: Option.getOrUndefined(telemetryConfig.wslDistroName),
          arch: hostArchitecture,
          t3CodeVersion: packageJson.version,
          clientType,
        },
        timestamp: event.capturedAt,
      })),
    };

    yield* HttpClientRequest.post(`${telemetryConfig.posthogHost}/batch/`).pipe(
      HttpClientRequest.bodyJson(payload),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  });

  const flush: AnalyticsService["Service"]["flush"] = Effect.gen(function* () {
    while (true) {
      if (!(yield* isTelemetryEnabled())) {
        yield* Ref.set(bufferRef, []);
        return;
      }

      const bufferedEvents = yield* Ref.get(bufferRef);
      if (bufferedEvents.length === 0) {
        return;
      }

      const batch = yield* Ref.modify(bufferRef, (current) => {
        if (current.length === 0) {
          return [[] as ReadonlyArray<BufferedAnalyticsEvent>, current] as const;
        }
        const nextBatch = current.slice(0, telemetryConfig.flushBatchSize);
        const remaining = current.slice(nextBatch.length);
        return [nextBatch, remaining] as const;
      });

      if (batch.length === 0) {
        return;
      }

      const telemetryEnabledAfterDequeue = yield* isTelemetryEnabled().pipe(
        Effect.catch((error) =>
          Ref.update(bufferRef, (current) => [...batch, ...current]).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
      if (!telemetryEnabledAfterDequeue) {
        yield* Ref.set(bufferRef, []);
        return;
      }

      const identifier = yield* resolveTelemetryIdentifier;
      if (!identifier) {
        yield* Ref.update(bufferRef, (current) => [...batch, ...current]);
        yield* Effect.logDebug("Deferring telemetry flush; identifier unavailable");
        return;
      }

      yield* sendBatch(batch).pipe(
        Effect.catch((error) =>
          Ref.update(bufferRef, (current) => [...batch, ...current]).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
    }
  }).pipe(Effect.catch((cause) => Effect.logDebug("Failed to flush telemetry", { cause })));

  const record: AnalyticsService["Service"]["record"] = Effect.fn("AnalyticsService.record")(
    function* (event, properties) {
      const telemetryEnabled = yield* isTelemetryEnabled().pipe(
        Effect.catch((cause) =>
          Effect.logDebug("Failed to read telemetry setting", { cause }).pipe(Effect.as(false)),
        ),
      );
      if (!telemetryEnabled) return;

      const enqueueResult = yield* enqueueBufferedEvent(event, properties);
      if (enqueueResult.dropped) {
        yield* Effect.logDebug("analytics buffer full; dropping oldest event", {
          size: enqueueResult.size,
          event,
        });
      }
    },
  );

  yield* Effect.forever(Effect.sleep(1000).pipe(Effect.flatMap(() => flush)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);

  yield* Effect.addFinalizer(() => flush);

  return AnalyticsService.of({ record, flush });
});

export const layer = Layer.effect(AnalyticsService, make);

export const layerTest = AnalyticsService.layerTest;
