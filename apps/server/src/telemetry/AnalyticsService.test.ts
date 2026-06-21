import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsError } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import * as ServerConfig from "../config.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import { getTelemetryIdentifier } from "./Identify.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

interface RecordedBatchRequest {
  readonly path: string;
  readonly body: {
    readonly batch?: ReadonlyArray<{
      readonly event?: string;
      readonly properties?: {
        readonly index?: number;
        readonly clientType?: string;
      };
    }>;
  } | null;
}

interface RecordedBatchBody {
  readonly batch: ReadonlyArray<{
    readonly event?: string;
    readonly properties?: {
      readonly index?: number;
      readonly clientType?: string;
    };
  }>;
}

it.layer(NodeServices.layer)("AnalyticsService test", (it) => {
  it.effect("defaults to disabled without creating a telemetry identifier", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-disabled-",
      });
      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(ServerSettingsModule.ServerSettingsService.layerTest()),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      const anonymousIdExists = yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;

        yield* analytics.record("test.disabled");
        yield* analytics.flush;

        return yield* fileSystem.exists(serverConfig.anonymousIdPath);
      }).pipe(Effect.provide(runtimeLayer));

      assert.equal(capturedRequests.length, 0);
      assert.equal(anonymousIdExists, false);
    }),
  );

  it.effect("uses the server telemetry setting as an opt-in", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-setting-",
      });
      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(
          ServerSettingsModule.ServerSettingsService.layerTest({ telemetryEnabled: true }),
        ),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;

        yield* analytics.record("test.setting.enabled");
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 1);
      assert.equal(batchRequests[0]?.body.batch[0]?.event, "test.setting.enabled");
    }),
  );

  it.effect("seeds telemetry opt-in from the environment before any saved preference", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-env-seed-",
      });
      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(ServerSettingsModule.ServerSettingsService.layerTest()),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

        assert.deepInclude(yield* serverSettings.getSettings, {
          telemetryEnabled: true,
          telemetryPreferenceSet: true,
        });
        yield* analytics.record("test.env-seeded.enabled");
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 1);
      assert.equal(batchRequests[0]?.body.batch[0]?.event, "test.env-seeded.enabled");
    }),
  );

  it.effect("honors an explicit environment telemetry opt-out over persisted opt-in", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-env-hard-opt-out-",
      });
      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(
          ServerSettingsModule.ServerSettingsService.layerTest({
            telemetryEnabled: true,
            telemetryPreferenceSet: true,
          }),
        ),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: false,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;

        yield* analytics.record("test.env-hard-opt-out.disabled");
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      assert.equal(capturedRequests.length, 0);
    }),
  );

  it.effect("does not let the environment override an explicit telemetry opt-out", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-env-explicit-opt-out-",
      });
      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(
          ServerSettingsModule.ServerSettingsService.layerTest({
            telemetryEnabled: false,
            telemetryPreferenceSet: true,
          }),
        ),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

        assert.deepInclude(yield* serverSettings.getSettings, {
          telemetryEnabled: false,
          telemetryPreferenceSet: true,
        });
        yield* analytics.record("test.env-opt-out.disabled");
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      assert.equal(capturedRequests.length, 0);
    }),
  );

  it.effect("flush drains all buffered events across multiple batches", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-base-",
      });

      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(
          ServerSettingsModule.ServerSettingsService.layerTest({ telemetryEnabled: true }),
        ),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
          T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "POST") {
            return HttpServerResponse.empty({ status: 404 });
          }

          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const telemetryIdentifier = yield* getTelemetryIdentifier;
        assert.equal(telemetryIdentifier !== null, true);
        const analytics = yield* AnalyticsService.AnalyticsService;

        for (let index = 0; index < 45; index += 1) {
          yield* analytics.record("test.flush.drain", { index });
        }

        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 3);
      assert.equal(
        batchRequests.every((request) => request.path === "/batch/" || request.path === "/batch"),
        true,
      );
      const deliveredIndexes = batchRequests.flatMap((request) =>
        request.body.batch
          .filter((event) => event.event === "test.flush.drain")
          .map((event) => event.properties?.index)
          .filter((index): index is number => typeof index === "number"),
      );

      const sorted = deliveredIndexes.toSorted((a, b) => a - b);
      assert.equal(sorted.length, 45);
      assert.deepEqual(
        sorted,
        Array.from({ length: 45 }, (_, index) => index),
      );
      assert.equal(
        batchRequests.every((request) =>
          request.body.batch.every((event) => event.properties?.clientType === "cli-web-client"),
        ),
        true,
      );
    }),
  );

  it.effect("stops flushing buffered batches after telemetry is disabled mid-flush", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-disable-mid-flush-",
      });

      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(
          ServerSettingsModule.ServerSettingsService.layerTest({ telemetryEnabled: true }),
        ),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
          T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "POST") {
            return HttpServerResponse.empty({ status: 404 });
          }

          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          if (capturedRequests.length === 1) {
            const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
            yield* serverSettings.updateSettings({ telemetryEnabled: false });
          }

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;

        for (let index = 0; index < 45; index += 1) {
          yield* analytics.record("test.flush.mid-disable", { index });
        }

        yield* analytics.flush;
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 1);
      const deliveredIndexes = batchRequests.flatMap((request) =>
        request.body.batch
          .filter((event) => event.event === "test.flush.mid-disable")
          .map((event) => event.properties?.index)
          .filter((index): index is number => typeof index === "number"),
      );

      assert.deepEqual(
        deliveredIndexes.toSorted((a, b) => a - b),
        Array.from({ length: 20 }, (_, index) => index),
      );
    }),
  );

  it.effect("retains buffered events when telemetry identifier is unavailable", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-missing-identifier-",
      });

      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(
          ServerSettingsModule.ServerSettingsService.layerTest({ telemetryEnabled: true }),
        ),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
          T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "POST") {
            return HttpServerResponse.empty({ status: 404 });
          }

          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const fileSystem = yield* FileSystem.FileSystem;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const emptyHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-telemetry-empty-home-",
        });
        const originalHome = process.env.HOME;
        process.env.HOME = emptyHome;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (originalHome === undefined) {
              delete process.env.HOME;
            } else {
              process.env.HOME = originalHome;
            }
          }),
        );
        yield* fileSystem.makeDirectory(serverConfig.anonymousIdPath);
        const analytics = yield* AnalyticsService.AnalyticsService;

        yield* analytics.record("test.flush.identifier-unavailable", { index: 0 });
        yield* analytics.flush;
        assert.equal(capturedRequests.length, 0);

        yield* fileSystem.remove(serverConfig.anonymousIdPath, { recursive: true, force: true });
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 1);
      assert.equal(batchRequests[0]?.body.batch[0]?.event, "test.flush.identifier-unavailable");
      assert.equal(batchRequests[0]?.body.batch[0]?.properties?.index, 0);
    }),
  );

  it.effect("retains a dequeued batch when telemetry setting read fails mid-flush", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-settings-read-failure-",
      });
      const remainingSuccessfulSettingsReads = yield* Ref.make(3);
      const settingsLayer = Layer.succeed(ServerSettingsModule.ServerSettingsService, {
        start: Effect.void,
        ready: Effect.void,
        getSettings: Effect.gen(function* () {
          const remaining = yield* Ref.get(remainingSuccessfulSettingsReads);
          if (remaining <= 0) {
            return yield* new ServerSettingsError({
              settingsPath: "<test>",
              operation: "read-file",
              cause: "Mock settings read failure",
            });
          }
          yield* Ref.set(remainingSuccessfulSettingsReads, remaining - 1);
          return {
            ...DEFAULT_SERVER_SETTINGS,
            telemetryEnabled: true,
          };
        }),
        updateSettings: () =>
          Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            telemetryEnabled: true,
          }),
        streamChanges: Stream.empty,
      });

      const telemetryLayer = AnalyticsService.layer.pipe(
        Layer.provideMerge(serverConfigLayer),
        Layer.provideMerge(settingsLayer),
      );
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "",
          T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "POST") {
            return HttpServerResponse.empty({ status: 404 });
          }

          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;

        yield* analytics.record("test.flush.settings-read-failure", { index: 0 });
        yield* analytics.flush;
        assert.equal(capturedRequests.length, 0);

        yield* Ref.set(remainingSuccessfulSettingsReads, 4);
        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 1);
      assert.equal(batchRequests[0]?.body.batch[0]?.event, "test.flush.settings-read-failure");
      assert.equal(batchRequests[0]?.body.batch[0]?.properties?.index, 0);
    }),
  );
});
