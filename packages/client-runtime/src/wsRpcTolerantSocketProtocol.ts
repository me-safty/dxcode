import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { constVoid, identity } from "effect/Function";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import * as RpcMessage from "effect/unstable/rpc/RpcMessage";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

export interface WsRpcHeartbeatConfig {
  readonly pingIntervalMs?: number;
  readonly missedPongLimit?: number;
}

export interface WsRpcTolerantSocketProtocolOptions {
  readonly retryTransientErrors?: boolean | undefined;
  readonly retryPolicy?: Schedule.Schedule<any, Socket.SocketError> | undefined;
  readonly heartbeat?: WsRpcHeartbeatConfig;
  readonly onHeartbeatPing?: () => void;
  readonly onHeartbeatTimeout?: () => void;
}

const DEFAULT_HEARTBEAT_CONFIG = {
  pingIntervalMs: 15_000,
  missedPongLimit: 3,
} as const satisfies Required<WsRpcHeartbeatConfig>;

const DEFAULT_RETRY_POLICY = Schedule.exponential(500, 1.5).pipe(
  Schedule.either(Schedule.spaced(5000)),
);

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function normalizeHeartbeatConfig(
  config: WsRpcHeartbeatConfig | undefined,
): Required<WsRpcHeartbeatConfig> {
  return {
    pingIntervalMs: normalizePositiveInteger(
      config?.pingIntervalMs,
      DEFAULT_HEARTBEAT_CONFIG.pingIntervalMs,
    ),
    missedPongLimit: normalizePositiveInteger(
      config?.missedPongLimit,
      DEFAULT_HEARTBEAT_CONFIG.missedPongLimit,
    ),
  };
}

function makePingTimeoutError() {
  return new Socket.SocketError({
    reason: new Socket.SocketOpenError({
      kind: "Timeout",
      cause: new Error("ping timeout"),
    }),
  });
}

function isPingTimeoutError(error: Socket.SocketError): boolean {
  return (
    error.reason._tag === "SocketOpenError" &&
    error.reason.cause instanceof Error &&
    error.reason.cause.message === "ping timeout"
  );
}

function makeUnknownSocketError(cause: Cause.Cause<unknown>) {
  return new RpcClientError.RpcClientDefect({
    message: "Unknown socket error",
    cause: Cause.squash(cause),
  });
}

function makeDecodeError(defect: unknown) {
  return new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({
      message: "Error decoding message",
      cause: defect,
    }),
  });
}

const makeTolerantPinger = Effect.fnUntraced(function* <A, E, R>(
  writePing: Effect.Effect<A, E, R>,
  config: Required<WsRpcHeartbeatConfig>,
  hooks: Pick<WsRpcTolerantSocketProtocolOptions, "onHeartbeatPing" | "onHeartbeatTimeout">,
) {
  let awaitingPong = false;
  let missedPongs = 0;
  const latch = Latch.makeUnsafe();
  const reset = () => {
    awaitingPong = false;
    missedPongs = 0;
    latch.closeUnsafe();
  };
  const onPong = () => {
    awaitingPong = false;
    missedPongs = 0;
  };

  yield* Effect.suspend((): Effect.Effect<void, E, R> => {
    if (awaitingPong) {
      missedPongs += 1;
      if (missedPongs >= config.missedPongLimit) {
        hooks.onHeartbeatTimeout?.();
        return latch.open.pipe(Effect.asVoid);
      }
    }

    awaitingPong = true;
    hooks.onHeartbeatPing?.();
    return writePing.pipe(Effect.asVoid);
  }).pipe(
    Effect.delay(Duration.millis(config.pingIntervalMs)),
    Effect.ignore,
    Effect.forever,
    Effect.interruptible,
    Effect.forkScoped,
  );

  return { timeout: latch.await, reset, onPong } as const;
});

export const makeWsRpcTolerantSocketProtocol = (options?: WsRpcTolerantSocketProtocolOptions) => {
  const heartbeat = normalizeHeartbeatConfig(options?.heartbeat);

  return RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const socket = yield* Socket.Socket;
      const serialization = yield* RpcSerialization.RpcSerialization;
      const hooks = yield* Effect.serviceOption(RpcClient.ConnectionHooks);
      const requestClientMap = new Map<string, number>();
      const write = yield* socket.writer;
      let parser = serialization.makeUnsafe();
      const pinger = yield* makeTolerantPinger(
        write(parser.encode(RpcMessage.constPing)!),
        heartbeat,
        options ?? {},
      );
      let currentError: RpcClientError.RpcClientError | undefined;

      const onOpen = Effect.suspend(() => {
        currentError = undefined;
        return Option.isSome(hooks) ? hooks.value.onConnect : Effect.void;
      });

      const broadcast = (response: RpcMessage.FromServerEncoded) =>
        Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response));

      yield* Effect.suspend(() => {
        parser = serialization.makeUnsafe();
        pinger.reset();
        return socket
          .runRaw(
            (message) => {
              try {
                const responses = parser.decode(message) as Array<RpcMessage.FromServerEncoded>;
                if (responses.length === 0) return;
                let i = 0;
                return Effect.whileLoop({
                  while: () => i < responses.length,
                  body: () => {
                    const response = responses[i++];
                    if (!response) {
                      return Effect.void;
                    }
                    if (response._tag === "Pong") {
                      pinger.onPong();
                      return Effect.void;
                    }
                    if ("requestId" in response) {
                      const clientId = requestClientMap.get(response.requestId);
                      if (clientId !== undefined) {
                        if (response._tag === "Exit") {
                          requestClientMap.delete(response.requestId);
                        }
                        return writeResponse(clientId, response);
                      }
                    }
                    return broadcast(response);
                  },
                  step: constVoid,
                });
              } catch (defect) {
                return broadcast({
                  _tag: "ClientProtocolError",
                  error: makeDecodeError(defect),
                });
              }
            },
            { onOpen },
          )
          .pipe(
            Effect.raceFirst(
              Effect.flatMap(pinger.timeout, () => Effect.fail(makePingTimeoutError())),
            ),
          );
      }).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) }),
          ),
        ),
        Option.isSome(hooks) ? Effect.ensuring(hooks.value.onDisconnect) : identity,
        Effect.tapCause((cause) => {
          const error = Cause.findError(cause);
          const hasError = Result.isSuccess(error);
          if (
            options?.retryTransientErrors &&
            hasError &&
            error.success.reason._tag === "SocketOpenError" &&
            !isPingTimeoutError(error.success)
          ) {
            return Effect.void;
          }

          currentError = new RpcClientError.RpcClientError({
            reason: hasError ? error.success.reason : makeUnknownSocketError(cause),
          });
          return broadcast({
            _tag: "ClientProtocolError",
            error: currentError,
          });
        }),
        Effect.retry(options?.retryPolicy ?? DEFAULT_RETRY_POLICY),
        Effect.annotateLogs({
          module: "WsRpcTolerantSocketProtocol",
          method: "makeWsRpcTolerantSocketProtocol",
        }),
        Effect.forkScoped,
      );

      return {
        send(clientId, request) {
          if (currentError) {
            return Effect.fail(currentError);
          }
          if (request._tag === "Request") {
            requestClientMap.set(request.id, clientId);
          }
          const encoded = parser.encode(request);
          if (encoded === undefined) return Effect.void;
          return Effect.orDie(write(encoded));
        },
        supportsAck: true,
        supportsTransferables: false,
      };
    }),
  ) satisfies Effect.Effect<
    RpcClient.Protocol["Service"],
    never,
    Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket
  >;
};
