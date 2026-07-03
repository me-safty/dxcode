import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  HttpClientError,
  HttpEgressBlockedError,
  makeHttpClientCapability,
  type PluginHttpClientTransport,
} from "./HttpClientCapability.ts";

const encoder = new TextEncoder();

function responseFor(input: {
  readonly url: URL;
  readonly method: string;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array | ArrayBuffer | null;
}) {
  const request = HttpClientRequest.make(input.method as "GET")(input.url.toString());
  return HttpClientResponse.fromWeb(
    request,
    new Response(input.body ?? "", {
      status: input.status ?? 200,
      headers: input.headers ?? {},
    }),
  );
}

function makeClient(input: {
  readonly lookup?: (host: string) => Effect.Effect<ReadonlyArray<string>, Error>;
  readonly transport?: PluginHttpClientTransport;
  readonly calls?: Array<{ readonly host: string; readonly address: string }>;
}) {
  return makeHttpClientCapability({
    lookup: input.lookup ?? (() => Effect.succeed(["140.82.112.3"])),
    transport:
      input.transport ??
      ((request) =>
        Effect.sync(() => {
          input.calls?.push({
            host: request.url.hostname,
            address: request.address.address,
          });
          return responseFor({
            url: request.url,
            method: request.method,
            headers: { "x-transport": "stub" },
            body: "ok",
          });
        })),
  });
}

describe("HttpClientCapability", () => {
  it.effect("rejects non-https and private egress before transport", () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const client = makeClient({
        lookup: () => Effect.succeed(["10.0.0.1"]),
        transport: () =>
          Effect.sync(() => {
            calls.push("transport");
            return responseFor({ url: new URL("https://never.test"), method: "GET" });
          }),
      });

      const httpError = yield* client
        .request({ method: "GET", url: "http://example.test" })
        .pipe(Effect.flip);
      const privateError = yield* client
        .request({ method: "GET", url: "https://internal.test" })
        .pipe(Effect.flip);

      assert.instanceOf(httpError, HttpEgressBlockedError);
      assert.instanceOf(privateError, HttpEgressBlockedError);
      assert.deepEqual(calls, []);
    }),
  );

  it.effect("pins the transport to the validated resolved address", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly host: string; readonly address: string }> = [];
      const client = makeClient({
        calls,
        lookup: () => Effect.succeed(["140.82.112.3", "140.82.113.4"]),
      });

      const result = yield* client.request({ method: "GET", url: "https://github.com/api" });

      assert.equal(result.status, 200);
      assert.equal(new TextDecoder().decode(result.body), "ok");
      assert.deepEqual(calls, [{ host: "github.com", address: "140.82.112.3" }]);
    }),
  );

  it.effect("rejects headers with control characters (CRLF injection) before transport", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly host: string; readonly address: string }> = [];
      const client = makeClient({ calls });

      const result = yield* Effect.exit(
        client.request({
          method: "GET",
          url: "https://github.com/api",
          headers: { "x-evil": "value\r\nx-injected: 1" },
        }),
      );

      assert.isTrue(result._tag === "Failure");
      assert.deepEqual(calls, []);
    }),
  );

  it.effect("rejects an oversized request body before transport", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly host: string; readonly address: string }> = [];
      const client = makeClient({ calls });

      const result = yield* Effect.exit(
        client.request({
          method: "POST",
          url: "https://github.com/api",
          body: new Uint8Array(33 * 1024 * 1024),
        }),
      );

      assert.isTrue(result._tag === "Failure");
      assert.deepEqual(calls, []);
    }),
  );

  it.effect("surfaces redirects without following them", () =>
    Effect.gen(function* () {
      const client = makeClient({
        transport: (request) =>
          Effect.succeed(
            responseFor({
              url: request.url,
              method: request.method,
              status: 302,
              headers: { location: "https://example.test/next" },
            }),
          ),
      });

      const result = yield* client.request({ method: "GET", url: "https://example.test/start" });

      assert.equal(result.status, 302);
      assert.equal(result.headers.location, "https://example.test/next");
    }),
  );

  it.effect("enforces response caps and maps timeout/transport failures", () =>
    Effect.gen(function* () {
      const tooLargeClient = makeClient({
        transport: (request) =>
          Effect.succeed(
            responseFor({
              url: request.url,
              method: request.method,
              body: encoder.encode("abcdef").buffer,
            }),
          ),
      });
      const timeoutClient = makeClient({
        transport: () =>
          Effect.fail(new HttpClientError({ host: "example.test", reason: "timeout" })),
      });

      const tooLarge = yield* tooLargeClient
        .request({
          method: "GET",
          url: "https://example.test/large",
          maxResponseBytes: 3,
        })
        .pipe(Effect.flip);
      const timeout = yield* timeoutClient
        .request({ method: "GET", url: "https://example.test/timeout", timeoutMs: 1 })
        .pipe(Effect.flip);

      assert.instanceOf(tooLarge, HttpClientError);
      assert.include(tooLarge.message, "example.test");
      assert.instanceOf(timeout, HttpClientError);
    }),
  );

  it.effect("allows http loopback only under T3_PLUGIN_DEV", () =>
    Effect.gen(function* () {
      const previous = process.env.T3_PLUGIN_DEV;
      const client = makeClient({ lookup: () => Effect.succeed(["127.0.0.1"]) });
      try {
        delete process.env.T3_PLUGIN_DEV;
        assert.instanceOf(
          yield* client.request({ method: "GET", url: "http://localhost:5173" }).pipe(Effect.flip),
          HttpEgressBlockedError,
        );
        process.env.T3_PLUGIN_DEV = "1";
        const result = yield* client.request({ method: "GET", url: "http://localhost:5173" });
        assert.equal(result.status, 200);
      } finally {
        if (previous === undefined) {
          delete process.env.T3_PLUGIN_DEV;
        } else {
          process.env.T3_PLUGIN_DEV = previous;
        }
      }
    }),
  );
});
