import { describe, it, assert } from "@effect/vitest";
import type {
  ProviderDriverKind,
  ServerProvider,
  ServerProviderUpdateState,
} from "@t3tools/contracts";
import { ServerProviderUpdateError } from "@t3tools/contracts";
import { Cause, Effect, Exit, Fiber, Ref, Schema, Stream } from "effect";

import type { ProcessRunResult } from "../processRunner.ts";
import type { ProviderRegistryShape } from "./Services/ProviderRegistry.ts";
import { makeProviderUpdater, type ProviderUpdateRunner } from "./providerUpdater.ts";

const baseProvider: ServerProvider = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const okResult = (stdout = ""): ProcessRunResult => ({
  stdout,
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
});

const failedResult = (stderr: string): ProcessRunResult => ({
  stdout: "",
  stderr,
  code: 1,
  signal: null,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeRegistry(initialProvider: ServerProvider = baseProvider) {
  return Effect.gen(function* () {
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([initialProvider]);
    const updateStatesRef = yield* Ref.make<ReadonlyArray<ServerProviderUpdateState>>([]);

    const setProviderUpdateState = (
      provider: ProviderDriverKind,
      updateState: ServerProviderUpdateState | null,
    ) =>
      Effect.gen(function* () {
        if (updateState) {
          yield* Ref.update(updateStatesRef, (states) => [...states, updateState]);
        }
        return yield* Ref.updateAndGet(providersRef, (providers) =>
          providers.map((candidate) => {
            if (candidate.driver !== provider) {
              return candidate;
            }
            if (!updateState) {
              const { updateState: _updateState, ...providerWithoutUpdateState } = candidate;
              return providerWithoutUpdateState;
            }
            return {
              ...candidate,
              updateState,
            };
          }),
        );
      });

    const registry: ProviderRegistryShape = {
      getProviders: Ref.get(providersRef),
      refresh: () => Ref.get(providersRef),
      refreshInstance: () => Ref.get(providersRef),
      setProviderUpdateState,
      streamChanges: Stream.empty,
    };

    return {
      registry,
      updateStatesRef,
    };
  });
}

describe("providerUpdater", () => {
  it.effect("runs the allowlisted provider update command and records success", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry();
      const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const updater = yield* makeProviderUpdater({
        providerRegistry: registry,
        runUpdate: async (command, args) => {
          calls.push({ command, args });
          return okResult("updated");
        },
      });

      const result = yield* updater.updateProvider("codex");
      assert.deepStrictEqual(calls, [
        {
          command: "npm",
          args: ["install", "-g", "@openai/codex@latest"],
        },
      ]);
      assert.strictEqual(result.providers[0]?.updateState?.status, "succeeded");
    }),
  );

  it.effect("records command failure output in provider update state", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry();
      const updater = yield* makeProviderUpdater({
        providerRegistry: registry,
        runUpdate: async () => failedResult("permission denied"),
      });

      const result = yield* updater.updateProvider("codex");
      const updateState = result.providers[0]?.updateState;

      assert.strictEqual(updateState?.status, "failed");
      assert.strictEqual(updateState?.message, "Update command exited with code 1.");
      assert.include(updateState?.output ?? "", "permission denied");
    }),
  );

  it.effect("prevents concurrent updates for the same provider", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry();
      const startedLatch: { resolve: () => void } = { resolve: () => {} };
      const releaseLatch: { resolve: () => void } = { resolve: () => {} };
      const started = new Promise<void>((resolve) => {
        startedLatch.resolve = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseLatch.resolve = resolve;
      });
      const runner: ProviderUpdateRunner = async () => {
        startedLatch.resolve();
        await release;
        return okResult();
      };
      const updater = yield* makeProviderUpdater({
        providerRegistry: registry,
        runUpdate: runner,
      });

      const first = yield* updater.updateProvider("codex").pipe(Effect.forkScoped);
      yield* Effect.promise(() => started);

      const second = yield* updater.updateProvider("codex").pipe(Effect.exit);
      assert.strictEqual(Exit.isFailure(second), true);
      if (Exit.isFailure(second)) {
        const error = Cause.squash(second.cause);
        assert.strictEqual(Schema.is(ServerProviderUpdateError)(error), true);
        if (Schema.is(ServerProviderUpdateError)(error)) {
          assert.include(error.reason, "already running");
        }
      }

      releaseLatch.resolve();
      yield* Fiber.join(first);
    }),
  );
});
