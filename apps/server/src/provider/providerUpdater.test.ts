import { describe, it, assert } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUpdateState,
} from "@t3tools/contracts";
import { ServerProviderUpdateError } from "@t3tools/contracts";
import { Cause, Effect, Exit, Fiber, Layer, Ref, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import type { ProcessRunResult } from "../processRunner.ts";
import type { ProviderRegistryShape } from "./Services/ProviderRegistry.ts";
import { makeProviderUpdater, type ProviderUpdateRunner } from "./providerUpdater.ts";
import {
  makeProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilities,
} from "./providerMaintenance.ts";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");
const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");
const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CURSOR_INSTANCE_ID = ProviderInstanceId.make("cursor");
const OPENCODE_INSTANCE_ID = ProviderInstanceId.make("opencode");

function lifecycleFor(provider: ProviderDriverKind): ProviderMaintenanceCapabilities {
  if (provider === CURSOR_DRIVER) {
    return makeProviderMaintenanceCapabilities({
      provider,
      packageName: null,
      updateExecutable: "agent",
      updateArgs: ["update"],
      updateLockKey: "cursor-agent",
    });
  }
  return makeProviderMaintenanceCapabilities({
    provider,
    packageName: provider === OPENCODE_DRIVER ? "opencode-ai" : "@openai/codex",
    updateExecutable: "npm",
    updateArgs:
      provider === OPENCODE_DRIVER
        ? ["install", "-g", "opencode-ai@latest"]
        : ["install", "-g", "@openai/codex@latest"],
    updateLockKey: "npm-global",
  });
}

const baseProvider: ServerProvider = {
  instanceId: CODEX_INSTANCE_ID,
  driver: CODEX_DRIVER,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const baseCursorProvider: ServerProvider = {
  ...baseProvider,
  instanceId: CURSOR_INSTANCE_ID,
  driver: CURSOR_DRIVER,
};

const baseOpenCodeProvider: ServerProvider = {
  ...baseProvider,
  instanceId: OPENCODE_INSTANCE_ID,
  driver: OPENCODE_DRIVER,
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

const latestVersionHttpClient = (version: string) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ version }, { headers: { "content-type": "application/json" } }),
        ),
      ),
    ),
  );

function makeRegistry(
  initialProviders: ServerProvider | ReadonlyArray<ServerProvider> = baseProvider,
) {
  return Effect.gen(function* () {
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
      Array.isArray(initialProviders) ? initialProviders : [initialProviders],
    );
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

    const setProviderInstanceUpdateState = (
      instanceId: ProviderInstanceId,
      updateState: ServerProviderUpdateState | null,
    ) =>
      Effect.gen(function* () {
        if (updateState) {
          yield* Ref.update(updateStatesRef, (states) => [...states, updateState]);
        }
        return yield* Ref.updateAndGet(providersRef, (providers) =>
          providers.map((candidate) => {
            if (candidate.instanceId !== instanceId) {
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
      getProviderMaintenanceCapabilities: (provider) => Effect.succeed(lifecycleFor(provider)),
      getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
        Effect.succeed(lifecycleFor(provider)),
      setProviderUpdateState,
      setProviderInstanceUpdateState,
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
      const { registry, updateStatesRef } = yield* makeRegistry(baseCursorProvider);
      const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const updater = yield* makeProviderUpdater({
        providerRegistry: registry,
        runUpdate: async (command, args) => {
          calls.push({ command, args });
          return okResult("updated");
        },
      });

      const result = yield* updater.updateProvider(CURSOR_DRIVER);
      assert.deepStrictEqual(calls, [
        {
          command: "agent",
          args: ["update"],
        },
      ]);
      assert.strictEqual(result.providers[0]?.updateState?.status, "succeeded");
      assert.deepStrictEqual(
        (yield* Ref.get(updateStatesRef)).map((state) => state.status),
        ["queued", "running", "succeeded"],
      );
    }),
  );

  it.effect("uses the resolved provider capabilities when choosing the update executable", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry({
        ...baseProvider,
        versionAdvisory: {
          status: "behind_latest",
          currentVersion: "2.0.14",
          latestVersion: "2.1.123",
          updateCommand: "bun i -g @anthropic-ai/claude-code@latest",
          canUpdate: true,
          checkedAt: "2026-04-30T12:00:00.000Z",
          message: "Update available.",
        },
      });
      const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const updater = yield* makeProviderUpdater({
        providerRegistry: {
          ...registry,
          getProviderMaintenanceCapabilities: () =>
            Effect.succeed(
              makeProviderMaintenanceCapabilities({
                provider: CODEX_DRIVER,
                packageName: "@openai/codex",
                updateExecutable: "bun",
                updateArgs: ["i", "-g", "@openai/codex@latest"],
                updateLockKey: "bun-global",
              }),
            ),
        },
        runUpdate: async (command, args) => {
          calls.push({ command, args });
          return okResult("updated");
        },
      });

      yield* updater.updateProvider(CODEX_DRIVER);
      assert.deepStrictEqual(calls, [
        {
          command: "bun",
          args: ["i", "-g", "@openai/codex@latest"],
        },
      ]);
    }),
  );

  it.effect("updates a single provider instance without touching sibling instances", () =>
    Effect.gen(function* () {
      const personalInstanceId = ProviderInstanceId.make("codex_personal");
      const workInstanceId = ProviderInstanceId.make("codex_work");
      const refreshedInstanceIds: Array<ProviderInstanceId> = [];
      const { registry } = yield* makeRegistry([
        {
          ...baseProvider,
          instanceId: personalInstanceId,
          version: "0.124.0-alpha.3",
        },
        {
          ...baseProvider,
          instanceId: workInstanceId,
          version: "0.124.0-alpha.3",
        },
      ]);
      const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const updater = yield* makeProviderUpdater({
        providerRegistry: {
          ...registry,
          getProviderMaintenanceCapabilitiesForInstance: (instanceId, provider) =>
            Effect.succeed(
              makeProviderMaintenanceCapabilities({
                provider,
                packageName: "@openai/codex-instance-test",
                updateExecutable: "vp",
                updateArgs: ["i", "-g", "@openai/codex"],
                updateLockKey: "vite-plus-global",
              }),
            ).pipe(
              Effect.tap(() =>
                Effect.sync(() => assert.strictEqual(instanceId, personalInstanceId)),
              ),
            ),
          refreshInstance: (instanceId) =>
            registry.refreshInstance(instanceId).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  refreshedInstanceIds.push(instanceId);
                }),
              ),
            ),
        },
        runUpdate: async (command, args) => {
          calls.push({ command, args });
          return okResult("updated");
        },
      });

      const result = yield* updater.updateProvider({
        provider: CODEX_DRIVER,
        instanceId: personalInstanceId,
      });

      assert.deepStrictEqual(calls, [
        {
          command: "vp",
          args: ["i", "-g", "@openai/codex"],
        },
      ]);
      assert.deepStrictEqual(refreshedInstanceIds, [personalInstanceId]);
      assert.strictEqual(result.providers[0]?.instanceId, personalInstanceId);
      assert.strictEqual(result.providers[0]?.updateState?.status, "succeeded");
      assert.strictEqual(result.providers[1]?.instanceId, workInstanceId);
      assert.strictEqual(result.providers[1]?.updateState, undefined);
    }).pipe(Effect.provide(latestVersionHttpClient("0.124.0-alpha.3"))),
  );

  it.effect("records command failure output in provider update state", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry();
      const updater = yield* makeProviderUpdater({
        providerRegistry: registry,
        runUpdate: async () => failedResult("permission denied"),
      });

      const result = yield* updater.updateProvider(CODEX_DRIVER);
      const updateState = result.providers[0]?.updateState;

      assert.strictEqual(updateState?.status, "failed");
      assert.strictEqual(updateState?.message, "Update command exited with code 1.");
      assert.include(updateState?.output ?? "", "permission denied");
    }),
  );

  it.effect(
    "marks successful commands as unchanged when the refreshed provider is still outdated",
    () =>
      Effect.gen(function* () {
        const { registry } = yield* makeRegistry({
          ...baseProvider,
          installed: true,
          version: "0.1.0",
        });
        const updater = yield* makeProviderUpdater({
          providerRegistry: registry,
          runUpdate: async () => okResult(),
        });

        const result = yield* updater.updateProvider(CODEX_DRIVER);

        assert.strictEqual(result.providers[0]?.updateState?.status, "unchanged");
        assert.include(result.providers[0]?.updateState?.message ?? "", "still detects");
      }).pipe(Effect.provide(latestVersionHttpClient("9.9.9"))),
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

      const first = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.forkScoped);
      yield* Effect.promise(() => started);

      const second = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.exit);
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

  it.effect("serializes different providers that share the same update lock key", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry([baseProvider, baseOpenCodeProvider]);
      const firstStartedLatch: { resolve: () => void } = { resolve: () => {} };
      const releaseFirstLatch: { resolve: () => void } = { resolve: () => {} };
      const firstStarted = new Promise<void>((resolve) => {
        firstStartedLatch.resolve = resolve;
      });
      const releaseFirst = new Promise<void>((resolve) => {
        releaseFirstLatch.resolve = resolve;
      });
      const calls: Array<string> = [];
      const updater = yield* makeProviderUpdater({
        providerRegistry: {
          ...registry,
          getProviderMaintenanceCapabilities: (provider) =>
            Effect.succeed(
              makeProviderMaintenanceCapabilities({
                provider,
                packageName: provider === OPENCODE_DRIVER ? "opencode-ai" : "@openai/codex",
                updateExecutable: "npm",
                updateArgs:
                  provider === OPENCODE_DRIVER
                    ? ["install", "-g", "opencode-ai@latest"]
                    : ["install", "-g", "@openai/codex@latest"],
                updateLockKey: "npm-global",
              }),
            ),
        },
        runUpdate: async (_command, args) => {
          calls.push(args.join(" "));
          if (calls.length === 1) {
            firstStartedLatch.resolve();
            await releaseFirst;
          }
          return okResult();
        },
      });

      const first = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.forkScoped);
      yield* Effect.promise(() => firstStarted);

      const second = yield* updater.updateProvider(OPENCODE_DRIVER).pipe(Effect.forkScoped);
      yield* Effect.promise(() => Promise.resolve());
      yield* Effect.promise(() => Promise.resolve());
      assert.deepStrictEqual(calls, ["install -g @openai/codex@latest"]);

      releaseFirstLatch.resolve();
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.deepStrictEqual(calls, [
        "install -g @openai/codex@latest",
        "install -g opencode-ai@latest",
      ]);
    }),
  );

  it.effect("releases the running-provider marker when the update lock key is unsupported", () =>
    Effect.gen(function* () {
      const { registry } = yield* makeRegistry(baseProvider);
      const updater = yield* makeProviderUpdater({
        providerRegistry: {
          ...registry,
          getProviderMaintenanceCapabilities: (provider) =>
            Effect.succeed(
              makeProviderMaintenanceCapabilities({
                provider,
                packageName: "@openai/codex",
                updateExecutable: "npm",
                updateArgs: ["install", "-g", "@openai/codex@latest"],
                updateLockKey: "unknown-lock-key",
              }),
            ),
        },
      });

      const first = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.exit);
      assert.strictEqual(Exit.isFailure(first), true);

      const second = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.exit);
      assert.strictEqual(Exit.isFailure(second), true);
      assert.deepStrictEqual(yield* registry.getProviders, [baseProvider]);

      if (Exit.isFailure(second)) {
        const error = Cause.squash(second.cause);
        assert.strictEqual(Schema.is(ServerProviderUpdateError)(error), true);
        if (Schema.is(ServerProviderUpdateError)(error)) {
          assert.include(error.reason, "Unsupported provider update lock key");
          assert.notInclude(error.reason, "already running");
        }
      }
    }),
  );

  it.effect(
    "releases the running-provider marker when interrupted after queuing but before the lock run starts",
    () =>
      Effect.gen(function* () {
        const { registry } = yield* makeRegistry(baseProvider);
        let blockQueuedState = true;
        const queuedStateWrittenLatch: { resolve: () => void } = { resolve: () => {} };
        const releaseQueuedStateLatch: { resolve: () => void } = { resolve: () => {} };
        const queuedStateWritten = new Promise<void>((resolve) => {
          queuedStateWrittenLatch.resolve = resolve;
        });
        const releaseQueuedState = new Promise<void>((resolve) => {
          releaseQueuedStateLatch.resolve = resolve;
        });

        const updater = yield* makeProviderUpdater({
          providerRegistry: {
            ...registry,
            setProviderUpdateState: (provider, updateState) =>
              Effect.gen(function* () {
                const providers = yield* registry.setProviderUpdateState(provider, updateState);
                if (updateState?.status === "queued" && blockQueuedState) {
                  queuedStateWrittenLatch.resolve();
                  yield* Effect.promise(() => releaseQueuedState);
                }
                return providers;
              }),
          },
          runUpdate: async () => okResult(),
        });

        const first = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.forkScoped);
        yield* Effect.promise(() => queuedStateWritten);
        blockQueuedState = false;

        yield* Fiber.interrupt(first);
        releaseQueuedStateLatch.resolve();

        const second = yield* updater.updateProvider(CODEX_DRIVER).pipe(Effect.exit);
        assert.strictEqual(Exit.isSuccess(second), true);
        if (Exit.isSuccess(second)) {
          assert.strictEqual(second.value.providers[0]?.updateState?.status, "succeeded");
        }
      }),
  );
});
