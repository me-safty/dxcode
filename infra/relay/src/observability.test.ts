import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import { FetchHttpClient } from "effect/unstable/http";
import type { OtlpTracer } from "effect/unstable/observability";
import { expect, it } from "vite-plus/test";

import { EnvironmentMintRequestFailed } from "./environments/EnvironmentConnector.ts";
import { makeRelayTraceLayer } from "./observability.ts";

const otlpAttributeValue = (value: {
  readonly stringValue?: string | null;
  readonly boolValue?: boolean | null;
  readonly intValue?: number | null;
  readonly doubleValue?: number | null;
}) => value.stringValue ?? value.boolValue ?? value.intValue ?? value.doubleValue;

it("exports schema error fields as span attributes", async () => {
  const NodeHttp = await import("node:http");
  let resolveRequest:
    | ((request: {
        readonly body: string;
        readonly headers: Record<string, string | ReadonlyArray<string> | undefined>;
      }) => void)
    | undefined;
  const firstRequest = new Promise<{
    readonly body: string;
    readonly headers: Record<string, string | ReadonlyArray<string> | undefined>;
  }>((resolve) => {
    resolveRequest = resolve;
  });
  const server = NodeHttp.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolveRequest?.({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: request.headers,
      });
      resolveRequest = undefined;
      response.statusCode = 204;
      response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP collector address");
  }

  const runtime = ManagedRuntime.make(
    makeRelayTraceLayer({
      tracesEndpoint: `http://127.0.0.1:${address.port}/v1/traces`,
      tracesDatasetName: "relay-test-traces",
      ingestToken: Redacted.make("test-token"),
    }).pipe(Layer.provide(FetchHttpClient.layer)),
  );

  try {
    await runtime.runPromise(
      Effect.fail(
        new EnvironmentMintRequestFailed({
          environmentId: "environment-1",
          operation: "connect",
          cause: new Error("upstream unavailable"),
        }),
      ).pipe(Effect.withSpan("relay.test.schema_error"), Effect.exit),
    );
    await runtime.dispose();

    const request = await Effect.runPromise(
      Effect.raceFirst(
        Effect.promise(() => firstRequest),
        Effect.sleep("1 second").pipe(
          Effect.andThen(Effect.die(new Error("Timed out waiting for OTLP trace export"))),
        ),
      ),
    );
    const payload = JSON.parse(request.body) as OtlpTracer.TraceData;
    const span = payload.resourceSpans
      .flatMap((resourceSpan) => resourceSpan.scopeSpans)
      .flatMap((scopeSpan) => scopeSpan.spans)
      .find((candidate) => candidate.name === "relay.test.schema_error");
    const attributes = Object.fromEntries(
      (span?.attributes ?? []).map((attribute) => [
        attribute.key,
        otlpAttributeValue(attribute.value),
      ]),
    );

    expect(request.headers.authorization).toBe("Bearer test-token");
    expect(request.headers["x-axiom-dataset"]).toBe("relay-test-traces");
    expect(attributes).toMatchObject({
      "error.type": "EnvironmentMintRequestFailed",
      "error.environmentId": "environment-1",
      "error.operation": "connect",
      "error.cause.name": "Error",
      "error.cause.message": "upstream unavailable",
    });
  } finally {
    await runtime.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});
