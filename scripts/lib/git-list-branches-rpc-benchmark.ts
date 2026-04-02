import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  GitListBranchesResult,
  WS_METHODS,
  WsGitListBranchesRpc,
  type GitListBranchesResult as GitListBranchesResultShape,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import * as fs from "node:fs/promises";
import * as Http from "node:http";
import * as path from "node:path";

const BenchmarkRpcGroup = RpcGroup.make(WsGitListBranchesRpc);
const makeBenchmarkRpcClient = RpcClient.make(BenchmarkRpcGroup);

type BenchmarkRpcClient =
  typeof makeBenchmarkRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

type BenchmarkMetricName =
  | "clientQueueToSendMs"
  | "networkToServerMs"
  | "serverDecodeDispatchMs"
  | "serverHandlerMs"
  | "serverEncodeSendMs"
  | "serverToClientMs"
  | "clientDecodeResolveMs"
  | "e2eMs";

type GitListBranchesFixtureEnvelope = {
  readonly _tag: "Exit";
  readonly requestId: string;
  readonly exit: {
    readonly _tag: "Success";
    readonly value: unknown;
  };
};

interface MutableIterationTrace {
  readonly iteration: number;
  requestId: string | null;
  requestStartedAtMs: number;
  requestEncodedSentAtMs: number | null;
  serverRequestReceivedAtMs: number | null;
  serverHandlerStartedAtMs: number | null;
  serverHandlerEndedAtMs: number | null;
  serverResponseSentAtMs: number | null;
  clientResponseReceivedAtMs: number | null;
  requestResolvedAtMs: number | null;
}

interface TraceStore {
  current: MutableIterationTrace | null;
}

export interface GitListBranchesRpcBenchmarkTrace {
  readonly iteration: number;
  readonly requestId: string;
  readonly timestampsMs: {
    readonly requestStarted: number;
    readonly requestEncodedSent: number;
    readonly serverRequestReceived: number;
    readonly serverHandlerStarted: number;
    readonly serverHandlerEnded: number;
    readonly serverResponseSent: number;
    readonly clientResponseReceived: number;
    readonly requestResolved: number;
  };
  readonly durationsMs: Record<BenchmarkMetricName, number>;
}

export interface GitListBranchesRpcBenchmarkMetricSummary {
  readonly minMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface GitListBranchesRpcBenchmarkReport {
  readonly fixturePath: string | null;
  readonly fixtureWasNormalized: boolean;
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly fixture: {
    readonly branchCount: number;
    readonly payloadBytes: number;
    readonly responseBytes: number;
  };
  readonly observedResult: {
    readonly branchCount: number;
    readonly currentBranchName: string | null;
    readonly hasOriginRemote: boolean;
    readonly isRepo: boolean;
  };
  readonly metrics: Record<BenchmarkMetricName, GitListBranchesRpcBenchmarkMetricSummary>;
  readonly traces: ReadonlyArray<GitListBranchesRpcBenchmarkTrace>;
}

export interface RunGitListBranchesRpcBenchmarkOptions {
  readonly cwd?: string;
  readonly fixturePath?: string;
  readonly fixtureValue?: GitListBranchesResultShape;
  readonly iterations?: number;
  readonly warmupIterations?: number;
}

function nowMs() {
  return performance.now();
}

function formatMilliseconds(value: number) {
  return value.toFixed(3);
}

function assertPresent(
  value: number | string | null,
  field: string,
  iteration: number,
): number | string {
  if (value === null) {
    throw new Error(`Benchmark trace ${iteration} is missing ${field}.`);
  }
  return value;
}

function finalizeTrace(trace: MutableIterationTrace): GitListBranchesRpcBenchmarkTrace {
  const requestId = assertPresent(trace.requestId, "requestId", trace.iteration) as string;
  const requestEncodedSent = assertPresent(
    trace.requestEncodedSentAtMs,
    "requestEncodedSentAtMs",
    trace.iteration,
  ) as number;
  const serverRequestReceived = assertPresent(
    trace.serverRequestReceivedAtMs,
    "serverRequestReceivedAtMs",
    trace.iteration,
  ) as number;
  const serverHandlerStarted = assertPresent(
    trace.serverHandlerStartedAtMs,
    "serverHandlerStartedAtMs",
    trace.iteration,
  ) as number;
  const serverHandlerEnded = assertPresent(
    trace.serverHandlerEndedAtMs,
    "serverHandlerEndedAtMs",
    trace.iteration,
  ) as number;
  const serverResponseSent = assertPresent(
    trace.serverResponseSentAtMs,
    "serverResponseSentAtMs",
    trace.iteration,
  ) as number;
  const clientResponseReceived = assertPresent(
    trace.clientResponseReceivedAtMs,
    "clientResponseReceivedAtMs",
    trace.iteration,
  ) as number;
  const requestResolved = assertPresent(
    trace.requestResolvedAtMs,
    "requestResolvedAtMs",
    trace.iteration,
  ) as number;

  return {
    iteration: trace.iteration,
    requestId,
    timestampsMs: {
      requestStarted: trace.requestStartedAtMs,
      requestEncodedSent,
      serverRequestReceived,
      serverHandlerStarted,
      serverHandlerEnded,
      serverResponseSent,
      clientResponseReceived,
      requestResolved,
    },
    durationsMs: {
      clientQueueToSendMs: requestEncodedSent - trace.requestStartedAtMs,
      networkToServerMs: serverRequestReceived - requestEncodedSent,
      serverDecodeDispatchMs: serverHandlerStarted - serverRequestReceived,
      serverHandlerMs: serverHandlerEnded - serverHandlerStarted,
      serverEncodeSendMs: serverResponseSent - serverHandlerEnded,
      serverToClientMs: clientResponseReceived - serverResponseSent,
      clientDecodeResolveMs: requestResolved - clientResponseReceived,
      e2eMs: requestResolved - trace.requestStartedAtMs,
    },
  };
}

function summarizeMetric(
  traces: ReadonlyArray<GitListBranchesRpcBenchmarkTrace>,
  metric: BenchmarkMetricName,
): GitListBranchesRpcBenchmarkMetricSummary {
  const values = traces
    .map((trace) => trace.durationsMs[metric])
    .toSorted((left, right) => left - right);
  const minMs = values[0] ?? 0;
  const maxMs = values.at(-1) ?? 0;
  const meanMs =
    values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

  const pickPercentile = (percentile: number) => {
    if (values.length === 0) {
      return 0;
    }
    const index = Math.min(values.length - 1, Math.ceil(values.length * percentile) - 1);
    return values[Math.max(0, index)] ?? 0;
  };

  return {
    minMs,
    meanMs,
    p50Ms: pickPercentile(0.5),
    p95Ms: pickPercentile(0.95),
    maxMs,
  };
}

function summarizeObservedResult(result: GitListBranchesResultShape) {
  return {
    branchCount: result.branches.length,
    currentBranchName: result.branches.find((branch) => branch.current)?.name ?? null,
    hasOriginRemote: result.hasOriginRemote,
    isRepo: result.isRepo,
  };
}

function normalizeFixtureValue(value: unknown) {
  const record = value as Partial<{
    readonly branches: unknown;
    readonly hasOriginRemote: unknown;
    readonly isRepo: unknown;
    readonly nextCursor: unknown;
    readonly totalCount: unknown;
  }>;

  const branches = Array.isArray(record.branches) ? record.branches : [];
  const hasNextCursor = Object.hasOwn(record, "nextCursor");
  const hasTotalCount = Object.hasOwn(record, "totalCount");

  return {
    normalizedValue: {
      ...record,
      branches,
      nextCursor: hasNextCursor ? record.nextCursor : null,
      totalCount: typeof record.totalCount === "number" ? record.totalCount : branches.length,
    },
    wasNormalized: !hasNextCursor || !hasTotalCount,
  };
}

function makeEmptyTrace(iteration: number): MutableIterationTrace {
  return {
    iteration,
    requestId: null,
    requestStartedAtMs: nowMs(),
    requestEncodedSentAtMs: null,
    serverRequestReceivedAtMs: null,
    serverHandlerStartedAtMs: null,
    serverHandlerEndedAtMs: null,
    serverResponseSentAtMs: null,
    clientResponseReceivedAtMs: null,
    requestResolvedAtMs: null,
  };
}

async function withBenchmarkClient<T>(
  wsUrl: string,
  traceStore: TraceStore,
  run: (options: {
    readonly client: BenchmarkRpcClient;
    readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
  }) => Promise<T>,
): Promise<T> {
  const clientProtocolLayer = Layer.unwrap(
    Effect.gen(function* () {
      const protocol = yield* RpcClient.makeProtocolSocket({ retryTransientErrors: true }).pipe(
        Effect.provide(
          Layer.mergeAll(NodeSocket.layerWebSocket(wsUrl), RpcSerialization.layerJson),
        ),
      );

      return Layer.succeed(RpcClient.Protocol, {
        ...protocol,
        run: (receive) =>
          protocol.run((message) => {
            const trace = traceStore.current;
            if (
              trace &&
              message._tag === "Exit" &&
              (trace.requestId === null || message.requestId === trace.requestId)
            ) {
              trace.clientResponseReceivedAtMs = nowMs();
            }
            return receive(message);
          }),
        send: (request, transferables) => {
          const trace = traceStore.current;
          if (trace && request._tag === "Request" && request.tag === WS_METHODS.gitListBranches) {
            trace.requestId = request.id;
            trace.requestEncodedSentAtMs = nowMs();
          }
          return protocol.send(request, transferables);
        },
      });
    }),
  );

  const runtime = ManagedRuntime.make(clientProtocolLayer);
  const scope = runtime.runSync(Scope.make());

  try {
    const client = await runtime.runPromise(Scope.provide(scope)(makeBenchmarkRpcClient));
    return await run({ client, runtime });
  } finally {
    await runtime.runPromise(Scope.close(scope, Exit.void));
    await runtime.dispose();
  }
}

function makeBenchmarkRpcRouteLayer(
  fixtureValue: GitListBranchesResultShape,
  traceStore: TraceStore,
) {
  const handlerLayer = BenchmarkRpcGroup.toLayer({
    [WS_METHODS.gitListBranches]: (_input) =>
      Effect.sync(() => {
        const trace = traceStore.current;
        if (trace) {
          trace.serverHandlerStartedAtMs = nowMs();
        }

        const result = fixtureValue;

        if (trace) {
          trace.serverHandlerEndedAtMs = nowMs();
        }

        return result;
      }),
  });

  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const { httpEffect, protocol } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket.pipe(
        Effect.provide(RpcSerialization.layerJson),
      );

      const wrappedProtocol = {
        ...protocol,
        run: (receive: Parameters<typeof protocol.run>[0]) =>
          protocol.run((clientId, message) => {
            const trace = traceStore.current;
            if (trace && message._tag === "Request" && message.tag === WS_METHODS.gitListBranches) {
              trace.requestId = message.id;
              trace.serverRequestReceivedAtMs = nowMs();
            }
            return receive(clientId, message);
          }),
        send: (
          clientId: number,
          message: Parameters<typeof protocol.send>[1],
          transferables?: Parameters<typeof protocol.send>[2],
        ) => {
          const trace = traceStore.current;
          if (
            trace &&
            message._tag === "Exit" &&
            (trace.requestId === null || message.requestId === trace.requestId)
          ) {
            trace.serverResponseSentAtMs = nowMs();
          }
          return protocol.send(clientId, message, transferables);
        },
      };

      yield* Layer.build(
        RpcServer.layer(BenchmarkRpcGroup).pipe(
          Layer.provide(Layer.succeed(RpcServer.Protocol, wrappedProtocol)),
          Layer.provide(handlerLayer),
        ),
      );
      yield* router.add("GET", "/ws", httpEffect);
    }),
  );
}

async function loadFixtureValue(options: RunGitListBranchesRpcBenchmarkOptions) {
  if (options.fixtureValue) {
    return {
      fixturePath: null,
      fixtureValue: options.fixtureValue,
      fixtureWasNormalized: false,
    };
  }

  const fixturePath = path.resolve(process.cwd(), options.fixturePath ?? "git-branches.json");
  const file = await fs.readFile(fixturePath, "utf8");
  const envelope = JSON.parse(file) as GitListBranchesFixtureEnvelope;

  if (envelope._tag !== "Exit" || envelope.exit?._tag !== "Success") {
    throw new Error(
      `Expected ${fixturePath} to contain a successful RPC exit envelope for git.listBranches.`,
    );
  }

  const normalized = normalizeFixtureValue(envelope.exit.value);

  return {
    fixturePath,
    fixtureValue: Schema.decodeUnknownSync(GitListBranchesResult)(normalized.normalizedValue),
    fixtureWasNormalized: normalized.wasNormalized,
  };
}

export async function runGitListBranchesRpcBenchmark(
  options: RunGitListBranchesRpcBenchmarkOptions = {},
): Promise<GitListBranchesRpcBenchmarkReport> {
  const iterations = options.iterations ?? 250;
  const warmupIterations = options.warmupIterations ?? 25;

  if (iterations <= 0) {
    throw new Error("iterations must be greater than 0.");
  }
  if (warmupIterations < 0) {
    throw new Error("warmupIterations must be greater than or equal to 0.");
  }

  const loadedFixture = await loadFixtureValue(options);
  const fixtureValue = loadedFixture.fixtureValue;
  const traceStore: TraceStore = { current: null };
  const fixturePath = loadedFixture.fixturePath;
  const payloadBytes = Buffer.byteLength(JSON.stringify(fixtureValue), "utf8");
  const responseBytes = Buffer.byteLength(
    JSON.stringify({
      _tag: "Exit",
      requestId: "benchmark",
      exit: {
        _tag: "Success",
        value: fixtureValue,
      },
    }),
    "utf8",
  );

  const traces = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          HttpRouter.serve(makeBenchmarkRpcRouteLayer(fixtureValue, traceStore), {
            disableListenLog: true,
            disableLogger: true,
          }),
        );

        const server = yield* HttpServer.HttpServer;
        const address = server.address as HttpServer.TcpAddress;
        const wsUrl = `ws://127.0.0.1:${address.port}/ws`;
        const cwd = options.cwd ?? "/tmp/repo";

        return yield* Effect.promise(() =>
          withBenchmarkClient(wsUrl, traceStore, async ({ client, runtime }) => {
            let observedResult: GitListBranchesResultShape | null = null;
            const measuredTraces: GitListBranchesRpcBenchmarkTrace[] = [];

            const runIteration = async (iteration: number, measure: boolean) => {
              const trace = makeEmptyTrace(iteration);
              traceStore.current = trace;

              try {
                const result = await runtime.runPromise(
                  client[WS_METHODS.gitListBranches]({ cwd }),
                );
                trace.requestResolvedAtMs = nowMs();
                observedResult = result;
              } finally {
                traceStore.current = null;
              }

              if (measure) {
                measuredTraces.push(finalizeTrace(trace));
              }
            };

            for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
              await runIteration(iteration, false);
            }

            for (let iteration = 0; iteration < iterations; iteration += 1) {
              await runIteration(iteration, true);
            }

            if (!observedResult) {
              throw new Error("Benchmark did not receive a git.listBranches result.");
            }

            return {
              observedResult,
              measuredTraces,
            };
          }),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeHttpServer.layer(Http.createServer, {
              host: "127.0.0.1",
              port: 0,
            }),
            NodeServices.layer,
          ),
        ),
      ),
    ),
  );

  return {
    fixturePath,
    fixtureWasNormalized: loadedFixture.fixtureWasNormalized,
    iterations,
    warmupIterations,
    fixture: {
      branchCount: fixtureValue.branches.length,
      payloadBytes,
      responseBytes,
    },
    observedResult: summarizeObservedResult(traces.observedResult),
    metrics: {
      clientQueueToSendMs: summarizeMetric(traces.measuredTraces, "clientQueueToSendMs"),
      networkToServerMs: summarizeMetric(traces.measuredTraces, "networkToServerMs"),
      serverDecodeDispatchMs: summarizeMetric(traces.measuredTraces, "serverDecodeDispatchMs"),
      serverHandlerMs: summarizeMetric(traces.measuredTraces, "serverHandlerMs"),
      serverEncodeSendMs: summarizeMetric(traces.measuredTraces, "serverEncodeSendMs"),
      serverToClientMs: summarizeMetric(traces.measuredTraces, "serverToClientMs"),
      clientDecodeResolveMs: summarizeMetric(traces.measuredTraces, "clientDecodeResolveMs"),
      e2eMs: summarizeMetric(traces.measuredTraces, "e2eMs"),
    },
    traces: traces.measuredTraces,
  };
}

function formatMetricSummary(
  label: string,
  summary: GitListBranchesRpcBenchmarkMetricSummary,
): string {
  return `${label}: mean=${formatMilliseconds(summary.meanMs)} p50=${formatMilliseconds(summary.p50Ms)} p95=${formatMilliseconds(summary.p95Ms)} min=${formatMilliseconds(summary.minMs)} max=${formatMilliseconds(summary.maxMs)}`;
}

function formatTrace(trace: GitListBranchesRpcBenchmarkTrace): string {
  return [
    `iteration=${trace.iteration}`,
    `requestId=${trace.requestId}`,
    `e2e=${formatMilliseconds(trace.durationsMs.e2eMs)}ms`,
    `serverDecode=${formatMilliseconds(trace.durationsMs.serverDecodeDispatchMs)}ms`,
    `serverHandler=${formatMilliseconds(trace.durationsMs.serverHandlerMs)}ms`,
    `serverEncode=${formatMilliseconds(trace.durationsMs.serverEncodeSendMs)}ms`,
    `clientDecode=${formatMilliseconds(trace.durationsMs.clientDecodeResolveMs)}ms`,
  ].join(" ");
}

export function formatGitListBranchesRpcBenchmarkReport(
  report: GitListBranchesRpcBenchmarkReport,
): string {
  const sampleTraces = report.traces.slice(0, 5);
  const lines = [
    "git.listBranches RPC decode benchmark",
    `fixture: ${report.fixturePath ?? "<inline fixture>"}`,
    `fixture normalized: ${report.fixtureWasNormalized}`,
    `iterations: ${report.iterations} measured, ${report.warmupIterations} warmup`,
    `fixture size: ${report.fixture.branchCount} branches, ${report.fixture.payloadBytes}B payload, ${report.fixture.responseBytes}B rpc response`,
    `observed result: ${report.observedResult.branchCount} branches, current=${report.observedResult.currentBranchName ?? "<none>"}, repo=${report.observedResult.isRepo}, origin=${report.observedResult.hasOriginRemote}`,
    "",
    "timings (ms)",
    formatMetricSummary("client queue -> send", report.metrics.clientQueueToSendMs),
    formatMetricSummary("network -> server", report.metrics.networkToServerMs),
    formatMetricSummary("server decode -> dispatch", report.metrics.serverDecodeDispatchMs),
    formatMetricSummary("server handler", report.metrics.serverHandlerMs),
    formatMetricSummary("server encode -> send", report.metrics.serverEncodeSendMs),
    formatMetricSummary("server -> client", report.metrics.serverToClientMs),
    formatMetricSummary("client decode -> resolve", report.metrics.clientDecodeResolveMs),
    formatMetricSummary("full e2e", report.metrics.e2eMs),
  ];

  if (sampleTraces.length > 0) {
    lines.push("", "sample traces");
    for (const trace of sampleTraces) {
      lines.push(formatTrace(trace));
    }
  }

  return lines.join("\n");
}
