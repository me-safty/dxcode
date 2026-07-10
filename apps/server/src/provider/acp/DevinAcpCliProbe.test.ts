/**
 * Optional integration check against a real `devin acp` install.
 * Enable with: T3_DEVIN_ACP_PROBE=1 bun run test DevinAcpCliProbe
 *
 * The probe assumes the user has previously run `devin auth login` (or
 * `WINDSURF_API_KEY` is set in the environment). The runtime never calls
 * `authenticate` — without credentials `session/new` will fail and the
 * test will surface the error.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect } from "vite-plus/test";

import { findDevinModelConfigOption, makeDevinAcpRuntime } from "./DevinAcpSupport.ts";

const makeProbeRuntime = Effect.gen(function* () {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* makeDevinAcpRuntime({
    devinSettings: { binaryPath: "devin" },
    environment: process.env,
    childProcessSpawner,
    cwd: process.cwd(),
    clientInfo: { name: "t3-devin-probe", version: "0.0.0" },
  });
});

describe.runIf(process.env.T3_DEVIN_ACP_PROBE === "1")("Devin ACP CLI probe", () => {
  it.effect("initializes against real devin acp without authenticate", () =>
    Effect.gen(function* () {
      const runtime = yield* makeProbeRuntime;
      const started = yield* runtime.start();
      expect(started.initializeResult).toBeDefined();
      expect(started.initializeResult.agentCapabilities?.loadSession).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("session/new advertises a model config option and session modes", () =>
    Effect.gen(function* () {
      const runtime = yield* makeProbeRuntime;
      const started = yield* runtime.start();
      const result = started.sessionSetupResult;

      expect(typeof started.sessionId).toBe("string");

      // Devin advertises models through a `configOptions` entry with
      // category "model", not via the typed `SessionModelState` field.
      // If this assertion fails the upstream surface has regressed.
      const modelOption = findDevinModelConfigOption(result.configOptions);
      expect(modelOption).toBeDefined();
      expect(modelOption?.type).toBe("select");
      if (modelOption?.type === "select") {
        expect(modelOption.options.length).toBeGreaterThan(0);
      }
      expect(started.modelConfigId).toBe("model");

      const modes = result.modes;
      expect(modes).toBeDefined();
      expect(modes?.availableModes.map((mode) => mode.id)).toContain("plan");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("session/set_config_option accepts a no-op switch to the current model", () =>
    Effect.gen(function* () {
      const runtime = yield* makeProbeRuntime;
      const started = yield* runtime.start();
      const modelOption = findDevinModelConfigOption(started.sessionSetupResult.configOptions);
      const currentModelId =
        modelOption?.type === "select" ? modelOption.currentValue?.trim() : undefined;
      expect(currentModelId).toBeDefined();
      if (!currentModelId) return;

      // No-op switch — selecting the model the session already runs on must
      // succeed against every Devin build that exposes the model config
      // option.
      yield* runtime.setModel(currentModelId);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
