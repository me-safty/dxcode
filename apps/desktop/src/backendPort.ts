import * as Effect from "effect/Effect";
import { NetService } from "@t3tools/shared/Net";

export const DEFAULT_DESKTOP_BACKEND_PORT = 3773;
const MAX_TCP_PORT = 65_535;

export interface ResolveDesktopBackendPortEffectOptions<R = NetService> {
  readonly host: string;
  readonly startPort?: number;
  readonly maxPort?: number;
  readonly requiredHosts?: ReadonlyArray<string>;
  readonly canListenOnHost?: (port: number, host: string) => Effect.Effect<boolean, Error, R>;
}

const defaultCanListenOnHostEffect = (
  port: number,
  host: string,
): Effect.Effect<boolean, Error, NetService> =>
  Effect.gen(function* () {
    const net = yield* NetService;
    return yield* net.canListenOnHost(port, host);
  }).pipe(Effect.mapError(toError));

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const isValidPort = (port: number): boolean =>
  Number.isInteger(port) && port >= 1 && port <= MAX_TCP_PORT;

const normalizeHosts = (
  host: string,
  requiredHosts: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.from(
    new Set(
      [host, ...requiredHosts]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0),
    ),
  );

function canListenOnAllHostsEffect<R>(
  port: number,
  hosts: ReadonlyArray<string>,
  canListenOnHost: (port: number, host: string) => Effect.Effect<boolean, Error, R>,
): Effect.Effect<boolean, Error, R> {
  return Effect.gen(function* () {
    for (const candidateHost of hosts) {
      if (!(yield* canListenOnHost(port, candidateHost))) {
        return false;
      }
    }

    return true;
  });
}

export function resolveDesktopBackendPortEffect<R = NetService>({
  host,
  startPort = DEFAULT_DESKTOP_BACKEND_PORT,
  maxPort = MAX_TCP_PORT,
  requiredHosts = [],
  canListenOnHost = defaultCanListenOnHostEffect as (
    port: number,
    host: string,
  ) => Effect.Effect<boolean, Error, R>,
}: ResolveDesktopBackendPortEffectOptions<R>): Effect.Effect<number, Error, R> {
  return Effect.gen(function* () {
    if (!isValidPort(startPort)) {
      return yield* Effect.fail(new Error(`Invalid desktop backend start port: ${startPort}`));
    }

    if (!isValidPort(maxPort)) {
      return yield* Effect.fail(new Error(`Invalid desktop backend max port: ${maxPort}`));
    }

    if (maxPort < startPort) {
      return yield* Effect.fail(
        new Error(`Desktop backend max port ${maxPort} is below start port ${startPort}`),
      );
    }

    const hostsToCheck = normalizeHosts(host, requiredHosts);

    for (let port = startPort; port <= maxPort; port += 1) {
      if (yield* canListenOnAllHostsEffect(port, hostsToCheck, canListenOnHost)) {
        return port;
      }
    }

    return yield* Effect.fail(
      new Error(
        `No desktop backend port is available on hosts ${hostsToCheck.join(", ")} between ${startPort} and ${maxPort}`,
      ),
    );
  });
}
