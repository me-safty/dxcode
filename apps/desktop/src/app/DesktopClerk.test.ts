import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const {
  createClerkBridgeMock,
  onBeforeSendHeadersMock,
  onHeadersReceivedMock,
  storageAdapter,
  storageMock,
} = vi.hoisted(() => ({
  createClerkBridgeMock: vi.fn(),
  onBeforeSendHeadersMock: vi.fn(),
  onHeadersReceivedMock: vi.fn(),
  storageAdapter: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  storageMock: vi.fn(),
}));

vi.mock("electron", () => ({
  session: {
    defaultSession: {
      webRequest: {
        onBeforeSendHeaders: onBeforeSendHeadersMock,
        onHeadersReceived: onHeadersReceivedMock,
      },
    },
  },
}));

vi.mock("@clerk/electron", () => ({
  createClerkBridge: createClerkBridgeMock,
}));

vi.mock("@clerk/electron/storage", () => ({
  storage: storageMock,
}));

import * as DesktopClerk from "./DesktopClerk.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const makeDesktopClerkLayer = (isDevelopment = true) => {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    stateDir: "/tmp/pathwayos-state",
    isDevelopment,
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

  return DesktopClerk.layer.pipe(
    Layer.provide(Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment)),
  );
};

describe("DesktopClerk", () => {
  beforeEach(() => {
    createClerkBridgeMock.mockReset();
    onBeforeSendHeadersMock.mockReset();
    onHeadersReceivedMock.mockReset();
    storageMock.mockReset();
  });

  it("derives the Clerk Frontend API hostname used by the desktop CSP", () => {
    const publishableKey = `pk_test_${btoa("clerk.pathwayos.codes$")}`;

    assert.equal(
      DesktopClerk.resolveDesktopClerkFrontendApiHostname(publishableKey),
      "clerk.pathwayos.codes",
    );
    assert.equal(DesktopClerk.resolveDesktopClerkFrontendApiHostname(""), undefined);
    assert.equal(DesktopClerk.resolveDesktopClerkFrontendApiHostname("invalid"), undefined);
  });

  it("strips Origin from Clerk native SDK requests", () => {
    const requestHeaders = {
      Accept: "*/*",
      Authorization: "Bearer client-jwt",
      Origin: "pathwayos-dev://app",
    };

    assert.deepEqual(
      DesktopClerk.sanitizeClerkNativeRequestHeaders(
        {
          requestHeaders,
          url: "https://clerk.pathwayos.codes/v1/client?_is_native=1",
        },
        "clerk.pathwayos.codes",
      ),
      {
        Accept: "*/*",
        Authorization: "Bearer client-jwt",
      },
    );
    assert.deepEqual(requestHeaders, {
      Accept: "*/*",
      Authorization: "Bearer client-jwt",
      Origin: "pathwayos-dev://app",
    });
  });

  it("leaves non-native or non-Clerk request headers untouched", () => {
    const requestHeaders = {
      Authorization: "Bearer token",
      Origin: "pathwayos-dev://app",
    };

    assert.strictEqual(
      DesktopClerk.sanitizeClerkNativeRequestHeaders(
        {
          requestHeaders,
          url: "https://clerk.pathwayos.codes/v1/client",
        },
        "clerk.pathwayos.codes",
      ),
      requestHeaders,
    );
    assert.strictEqual(
      DesktopClerk.sanitizeClerkNativeRequestHeaders(
        {
          requestHeaders,
          url: "https://other.example.test/v1/client?_is_native=1",
        },
        "clerk.pathwayos.codes",
      ),
      requestHeaders,
    );
  });

  it("adds CORS response headers to Clerk native SDK responses", () => {
    const responseHeaders = DesktopClerk.withClerkNativeCorsResponseHeaders(
      {
        responseHeaders: {
          Existing: ["yes"],
          "access-control-allow-origin": ["https://old.example.test"],
        },
        url: "https://clerk.pathwayos.codes/v1/client?_is_native=1",
      },
      "clerk.pathwayos.codes",
      "pathwayos-dev://app",
    );

    assert.deepEqual(responseHeaders, {
      Existing: ["yes"],
      "Access-Control-Allow-Origin": ["pathwayos-dev://app"],
      "Access-Control-Allow-Methods": ["GET,POST,PUT,PATCH,DELETE,OPTIONS"],
      "Access-Control-Allow-Headers": ["authorization,content-type"],
      "Access-Control-Expose-Headers": ["authorization"],
      "Access-Control-Max-Age": ["600"],
    });
  });

  it.effect("installs a scoped Clerk native SDK request sanitizer", () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* DesktopClerk.installClerkNativeRequestHeaderSanitizer(
            "clerk.pathwayos.codes",
            "pathwayos-dev://app",
          );

          assert.equal(onBeforeSendHeadersMock.mock.calls.length, 1);
          assert.deepEqual(onBeforeSendHeadersMock.mock.calls[0]?.[0], {
            urls: ["https://clerk.pathwayos.codes/*"],
          });
          assert.equal(onHeadersReceivedMock.mock.calls.length, 1);
          assert.deepEqual(onHeadersReceivedMock.mock.calls[0]?.[0], {
            urls: ["https://clerk.pathwayos.codes/*"],
          });

          const listener = onBeforeSendHeadersMock.mock.calls[0]?.[1];
          assert.equal(typeof listener, "function");
          const callback = vi.fn();
          listener(
            {
              requestHeaders: {
                Authorization: "Bearer client-jwt",
                Origin: "pathwayos-dev://app",
              },
              url: "https://clerk.pathwayos.codes/v1/environment?_is_native=1",
            },
            callback,
          );

          assert.deepEqual(callback.mock.calls, [
            [
              {
                requestHeaders: {
                  Authorization: "Bearer client-jwt",
                },
              },
            ],
          ]);

          const responseListener = onHeadersReceivedMock.mock.calls[0]?.[1];
          assert.equal(typeof responseListener, "function");
          const responseCallback = vi.fn();
          responseListener(
            {
              responseHeaders: {},
              url: "https://clerk.pathwayos.codes/v1/environment?_is_native=1",
            },
            responseCallback,
          );

          assert.deepEqual(responseCallback.mock.calls, [
            [
              {
                responseHeaders: {
                  "Access-Control-Allow-Origin": ["pathwayos-dev://app"],
                  "Access-Control-Allow-Methods": ["GET,POST,PUT,PATCH,DELETE,OPTIONS"],
                  "Access-Control-Allow-Headers": ["authorization,content-type"],
                  "Access-Control-Expose-Headers": ["authorization"],
                  "Access-Control-Max-Age": ["600"],
                },
              },
            ],
          ]);
        }),
      );

      assert.deepEqual(onBeforeSendHeadersMock.mock.calls[1], [
        { urls: ["https://clerk.pathwayos.codes/*"] },
        null,
      ]);
      assert.deepEqual(onHeadersReceivedMock.mock.calls[1], [
        { urls: ["https://clerk.pathwayos.codes/*"] },
        null,
      ]);
    }),
  );

  it.effect("acquires and releases the SDK bridge with the layer", () => {
    const cleanup = vi.fn();
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup });

    return Effect.gen(function* () {
      yield* Effect.scoped(Layer.build(makeDesktopClerkLayer()));

      assert.deepEqual(createClerkBridgeMock.mock.calls, [
        [
          {
            storage: storageAdapter,
            passkeys: true,
            renderer: {
              scheme: "pathwayos-dev",
              host: "app",
              privileges: { corsEnabled: false },
            },
          },
        ],
      ]);
      assert.equal(cleanup.mock.calls.length, 1);
      storageMock.mockClear();
      createClerkBridgeMock.mockClear();
    });
  });

  it.effect("preserves bridge initialization failures", () => {
    const cause = new Error("bridge initialization failed");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockImplementationOnce(() => {
      throw cause;
    });

    return Effect.gen(function* () {
      const error = yield* Effect.scoped(Layer.build(makeDesktopClerkLayer())).pipe(Effect.flip);

      assert.instanceOf(error, DesktopClerk.DesktopClerkBridgeInitializationError);
      assert.equal(error.stateDir, "/tmp/pathwayos-state");
      assert.equal(error.isDevelopment, true);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        'Failed to initialize the desktop Clerk bridge for state directory "/tmp/pathwayos-state" (development: true).',
      );
    });
  });

  it.effect("preserves bridge cleanup failures", () => {
    const cause = new Error("bridge cleanup failed");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({
      cleanup: () => {
        throw cause;
      },
    });

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(makeDesktopClerkLayer(false))));

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, DesktopClerk.DesktopClerkBridgeCleanupError);
        assert.equal(error.stateDir, "/tmp/pathwayos-state");
        assert.equal(error.isDevelopment, false);
        assert.strictEqual(error.cause, cause);
        assert.equal(
          error.message,
          'Failed to clean up the desktop Clerk bridge for state directory "/tmp/pathwayos-state" (development: false).',
        );
      }
    });
  });

  it.each([
    { isDevelopment: true, scheme: "pathwayos-dev" },
    { isDevelopment: false, scheme: "pathwayos" },
  ])("configures the SDK with the $scheme renderer origin", ({ isDevelopment, scheme }) => {
    const bridge = { cleanup: vi.fn() };
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue(bridge);

    assert.equal(
      DesktopClerk.createDesktopClerkBridge("/tmp/pathwayos-state", isDevelopment),
      bridge,
    );
    assert.deepEqual(storageMock.mock.calls, [[{ path: "/tmp/pathwayos-state" }]]);
    assert.deepEqual(createClerkBridgeMock.mock.calls, [
      [
        {
          storage: storageAdapter,
          passkeys: true,
          renderer: {
            scheme,
            host: "app",
            privileges: { corsEnabled: false },
          },
        },
      ],
    ]);
    storageMock.mockClear();
    createClerkBridgeMock.mockClear();
  });
});
