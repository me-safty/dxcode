import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { NetService } from "@t3tools/shared/Net";

import { resolveDesktopBackendPortEffect } from "./backendPort.ts";

type ProbeCall = readonly [port: number, host: string];

describe("resolveDesktopBackendPortEffect", () => {
  it.effect("returns the starting port when it is available", () =>
    Effect.gen(function* () {
      const calls: ProbeCall[] = [];
      const port = yield* resolveDesktopBackendPortEffect({
        host: "127.0.0.1",
        startPort: 3773,
        canListenOnHost: (candidatePort, host) =>
          Effect.sync(() => {
            calls.push([candidatePort, host]);
            return candidatePort === 3773;
          }),
      });

      assert.equal(port, 3773);
      assert.deepEqual(calls, [[3773, "127.0.0.1"]]);
    }),
  );

  it.effect("increments sequentially until it finds an available port", () =>
    Effect.gen(function* () {
      const calls: ProbeCall[] = [];
      const port = yield* resolveDesktopBackendPortEffect({
        host: "127.0.0.1",
        startPort: 3773,
        canListenOnHost: (candidatePort, host) =>
          Effect.sync(() => {
            calls.push([candidatePort, host]);
            return candidatePort === 3775;
          }),
      });

      assert.equal(port, 3775);
      assert.deepEqual(calls, [
        [3773, "127.0.0.1"],
        [3774, "127.0.0.1"],
        [3775, "127.0.0.1"],
      ]);
    }),
  );

  it.effect("treats wildcard-bound ports as unavailable even when loopback probing succeeds", () =>
    Effect.gen(function* () {
      const calls: ProbeCall[] = [];
      const port = yield* resolveDesktopBackendPortEffect({
        host: "127.0.0.1",
        requiredHosts: ["0.0.0.0"],
        startPort: 3773,
        canListenOnHost: (candidatePort, host) =>
          Effect.sync(() => {
            calls.push([candidatePort, host]);
            if (candidatePort === 3773 && host === "127.0.0.1") return true;
            if (candidatePort === 3773 && host === "0.0.0.0") return false;
            return candidatePort === 3774;
          }),
      });

      assert.equal(port, 3774);
      assert.deepEqual(calls, [
        [3773, "127.0.0.1"],
        [3773, "0.0.0.0"],
        [3774, "127.0.0.1"],
        [3774, "0.0.0.0"],
      ]);
    }),
  );

  it.effect("checks overlapping hosts sequentially to avoid self-interference", () =>
    Effect.gen(function* () {
      let inFlightCount = 0;
      const calls: ProbeCall[] = [];
      const port = yield* resolveDesktopBackendPortEffect({
        host: "127.0.0.1",
        requiredHosts: ["0.0.0.0", "::"],
        startPort: 3773,
        maxPort: 3773,
        canListenOnHost: (candidatePort, host) =>
          Effect.gen(function* () {
            calls.push([candidatePort, host]);
            inFlightCount += 1;
            const overlapped = inFlightCount > 1;
            yield* Effect.yieldNow;
            inFlightCount -= 1;
            return !overlapped;
          }),
      });

      assert.equal(port, 3773);
      assert.deepEqual(calls, [
        [3773, "127.0.0.1"],
        [3773, "0.0.0.0"],
        [3773, "::"],
      ]);
    }),
  );

  it.effect("fails when the scan range is exhausted", () =>
    Effect.gen(function* () {
      const calls: ProbeCall[] = [];
      const result = yield* Effect.flip(
        resolveDesktopBackendPortEffect({
          host: "127.0.0.1",
          startPort: 65_534,
          maxPort: 65_535,
          canListenOnHost: (candidatePort, host) =>
            Effect.sync(() => {
              calls.push([candidatePort, host]);
              return false;
            }),
        }),
      );

      assert.equal(
        result.message,
        "No desktop backend port is available on hosts 127.0.0.1 between 65534 and 65535",
      );
      assert.deepEqual(calls, [
        [65_534, "127.0.0.1"],
        [65_535, "127.0.0.1"],
      ]);
    }),
  );

  it.effect("uses the injected NetService by default", () =>
    Effect.gen(function* () {
      const port = yield* resolveDesktopBackendPortEffect({
        host: "127.0.0.1",
        startPort: 3773,
        maxPort: 3773,
      });

      assert.equal(port, 3773);
    }).pipe(
      Effect.provideService(NetService, {
        canListenOnHost: (port) => Effect.succeed(port === 3773),
        isPortAvailableOnLoopback: () => Effect.succeed(true),
        reserveLoopbackPort: () => Effect.succeed(3773),
        findAvailablePort: (preferred) => Effect.succeed(preferred),
      }),
    ),
  );
});
