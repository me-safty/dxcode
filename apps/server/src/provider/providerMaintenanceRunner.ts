import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ServerProviderUpdateError,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUpdatedPayload,
  type ServerProviderUpdateState,
} from "@t3tools/contracts";
import { Cause, Duration, Effect, Option, PlatformError, Ref, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type { ProviderRegistryShape } from "./Services/ProviderRegistry.ts";
import { makeProviderMaintenanceCommandCoordinator } from "./providerMaintenanceCommandCoordinator.ts";
import { enrichProviderSnapshotWithVersionAdvisory } from "./providerMaintenance.ts";
import type { ProviderMaintenanceCapabilities } from "./providerMaintenance.ts";

const UPDATE_TIMEOUT_MS = 5 * 60_000;
const UPDATE_OUTPUT_MAX_BYTES = 10_000;

export interface ProviderMaintenanceCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export type ProviderMaintenanceCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<ProviderMaintenanceCommandResult>;

export interface ProviderMaintenanceRunnerShape {
  readonly updateProvider: (
    target:
      | ProviderDriverKind
      | {
          readonly provider: ProviderDriverKind;
          readonly instanceId?: ProviderInstanceId | undefined;
        },
  ) => Effect.Effect<ServerProviderUpdatedPayload, ServerProviderUpdateError>;
}

interface VerifiedProviderRefresh {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly verifiedProviders: ReadonlyArray<ServerProvider>;
}

interface CollectedText {
  readonly text: string;
  readonly truncated: boolean;
}

function collectText(
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
): Effect.Effect<CollectedText, Error> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let truncated = false;

  return Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => {
      if (truncated) return;

      const remainingBytes = UPDATE_OUTPUT_MAX_BYTES - bytes;
      if (remainingBytes <= 0) {
        truncated = true;
        return;
      }

      const nextChunk = chunk.byteLength > remainingBytes ? chunk.slice(0, remainingBytes) : chunk;
      text += decoder.decode(nextChunk, { stream: true });
      bytes += nextChunk.byteLength;
      if (chunk.byteLength > remainingBytes) {
        truncated = true;
      }
    }),
  ).pipe(
    Effect.mapError((cause) => new Error(`Failed to read update command output: ${cause.message}`)),
    Effect.as({
      get text() {
        return truncated ? text : `${text}${decoder.decode()}`;
      },
      get truncated() {
        return truncated;
      },
    }),
  );
}

function runProviderMaintenanceCommandWithSpawner(input: {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}): Effect.Effect<ProviderMaintenanceCommandResult, Error> {
  const run = Effect.gen(function* () {
    const child = yield* input.spawner
      .spawn(ChildProcess.make(input.command, [...input.args]))
      .pipe(
        Effect.mapError(
          (cause) => new Error(`Failed to run update command ${input.command}: ${cause.message}`),
        ),
      );
    yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [collectText(child.stdout), collectText(child.stderr), child.exitCode],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new Error(cause instanceof Error ? cause.message : "Update command failed to run."),
      ),
    );

    return {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode: Number(exitCode),
      timedOut: false,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    } satisfies ProviderMaintenanceCommandResult;
  });

  return run.pipe(
    Effect.scoped,
    Effect.timeoutOption(Duration.millis(UPDATE_TIMEOUT_MS)),
    Effect.map((result) =>
      Option.match(result, {
        onSome: (value) => value,
        onNone: () =>
          ({
            stdout: "",
            stderr: "",
            exitCode: null,
            timedOut: true,
            stdoutTruncated: false,
            stderrTruncated: false,
          }) satisfies ProviderMaintenanceCommandResult,
      }),
    ),
  );
}

function trimNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function commandOutput(result: ProviderMaintenanceCommandResult): string | null {
  const output = trimNullable([result.stderr, result.stdout].filter(Boolean).join("\n\n"));
  if (!output) {
    return null;
  }
  return truncateText(output, UPDATE_OUTPUT_MAX_BYTES);
}

function failureMessage(result: ProviderMaintenanceCommandResult): string {
  if (result.timedOut) {
    return "Update timed out.";
  }
  if (result.exitCode !== null && result.exitCode !== 0) {
    return `Update command exited with code ${result.exitCode}.`;
  }
  return "Update command failed.";
}

function isOutdatedProvider(provider: ServerProvider | undefined): boolean {
  return provider?.versionAdvisory?.status === "behind_latest";
}

function makeUpdateState(input: {
  readonly status: ServerProviderUpdateState["status"];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly message: string | null;
  readonly output?: string | null;
}): ServerProviderUpdateState {
  return {
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    message: input.message,
    output: input.output ?? null,
  };
}

export function makeProviderMaintenanceRunner(input: {
  readonly providerRegistry: ProviderRegistryShape;
  readonly runMaintenanceCommand: ProviderMaintenanceCommandRunner;
}): Effect.Effect<ProviderMaintenanceRunnerShape>;
export function makeProviderMaintenanceRunner(input: {
  readonly providerRegistry: ProviderRegistryShape;
  readonly runMaintenanceCommand?: undefined;
}): Effect.Effect<ProviderMaintenanceRunnerShape, never, ChildProcessSpawner.ChildProcessSpawner>;
export function makeProviderMaintenanceRunner(input: {
  readonly providerRegistry: ProviderRegistryShape;
  readonly runMaintenanceCommand?: ProviderMaintenanceCommandRunner | undefined;
}) {
  return Effect.gen(function* () {
    const spawner =
      input.runMaintenanceCommand === undefined
        ? yield* ChildProcessSpawner.ChildProcessSpawner
        : null;
    const runMaintenanceCommand =
      input.runMaintenanceCommand ??
      ((command, args) =>
        runProviderMaintenanceCommandWithSpawner({
          spawner: spawner as ChildProcessSpawner.ChildProcessSpawner["Service"],
          command,
          args,
        }));
    const commandCoordinator = yield* makeProviderMaintenanceCommandCoordinator({
      makeAlreadyRunningError: () =>
        new ServerProviderUpdateError({
          provider: ProviderDriverKind.make("unknown"),
          reason: "An update is already running for this provider.",
        }),
    });

    const verifyRefreshedProvider = (
      provider: ProviderDriverKind,
      maintenanceCapabilities: ProviderMaintenanceCapabilities,
      instanceId: ProviderInstanceId,
    ): Effect.Effect<VerifiedProviderRefresh> =>
      input.providerRegistry.getProviders.pipe(
        Effect.map((providers) =>
          providers
            .filter(
              (candidate) => candidate.driver === provider && candidate.instanceId === instanceId,
            )
            .map((candidate) => candidate.instanceId),
        ),
        Effect.flatMap((instanceIds) =>
          instanceIds.length === 0
            ? input.providerRegistry.refreshInstance(instanceId)
            : Effect.forEach(
                instanceIds,
                (instanceId) => input.providerRegistry.refreshInstance(instanceId),
                {
                  concurrency: "unbounded",
                  discard: true,
                },
              ).pipe(Effect.andThen(input.providerRegistry.getProviders)),
        ),
        Effect.flatMap((providers) => {
          const refreshedProviders = providers.filter(
            (candidate) => candidate.driver === provider && candidate.instanceId === instanceId,
          );
          if (refreshedProviders.length === 0) {
            return Effect.succeed<VerifiedProviderRefresh>({
              providers,
              verifiedProviders: [],
            });
          }
          return Effect.forEach(
            refreshedProviders,
            (refreshedProvider) =>
              enrichProviderSnapshotWithVersionAdvisory(refreshedProvider, maintenanceCapabilities),
            {
              concurrency: "unbounded",
            },
          ).pipe(
            Effect.map(
              (verifiedProviders): VerifiedProviderRefresh => ({
                providers,
                verifiedProviders,
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("Provider post-update version verification failed", {
                provider,
                cause: Cause.pretty(cause),
              }).pipe(
                Effect.as<VerifiedProviderRefresh>({
                  providers,
                  verifiedProviders: refreshedProviders,
                }),
              ),
            ),
          );
        }),
      );

    const updateProvider: ProviderMaintenanceRunnerShape["updateProvider"] = (target) =>
      Effect.gen(function* () {
        const provider = typeof target === "string" ? target : target.provider;
        const instanceId =
          typeof target === "string"
            ? defaultInstanceIdForDriver(provider)
            : (target.instanceId ?? defaultInstanceIdForDriver(provider));
        const targetKey = `instance:${instanceId}`;
        const capabilities =
          yield* input.providerRegistry.getProviderMaintenanceCapabilitiesForInstance(
            instanceId,
            provider,
          );
        const update = capabilities.update;
        if (!update) {
          return yield* new ServerProviderUpdateError({
            provider,
            reason: "This provider does not support one-click updates.",
          });
        }

        return yield* commandCoordinator
          .withCommandLock({
            targetKey,
            lockKey: update.lockKey,
            run: Effect.gen(function* () {
              const setUpdateState = (state: ServerProviderUpdateState | null) =>
                input.providerRegistry.setProviderMaintenanceActionState({
                  instanceId,
                  action: "update",
                  state,
                });

              yield* setUpdateState(
                makeUpdateState({
                  status: "queued",
                  startedAt: null,
                  finishedAt: null,
                  message: "Waiting for another provider update to finish.",
                }),
              );

              const finish = (state: ServerProviderUpdateState) =>
                setUpdateState(state).pipe(Effect.map((providers) => ({ providers })));
              const startedAtRef = yield* Ref.make<string | null>(null);

              const run = Effect.gen(function* () {
                const startedAt = new Date().toISOString();
                yield* Ref.set(startedAtRef, startedAt);
                yield* setUpdateState(
                  makeUpdateState({
                    status: "running",
                    startedAt,
                    finishedAt: null,
                    message: "Updating provider.",
                  }),
                );

                const result = yield* runMaintenanceCommand(update.executable, update.args);
                const finishedAt = new Date().toISOString();
                if (result.timedOut || result.exitCode !== 0) {
                  return yield* finish(
                    makeUpdateState({
                      status: "failed",
                      startedAt,
                      finishedAt,
                      message: failureMessage(result),
                      output: commandOutput(result),
                    }),
                  );
                }

                const { verifiedProviders } = yield* verifyRefreshedProvider(
                  provider,
                  capabilities,
                  instanceId,
                );
                const couldNotVerify = verifiedProviders.length === 0;
                const stillOutdated =
                  couldNotVerify ||
                  verifiedProviders.some((verifiedProvider) =>
                    isOutdatedProvider(verifiedProvider),
                  );
                return yield* finish(
                  makeUpdateState({
                    status: stillOutdated ? "unchanged" : "succeeded",
                    startedAt,
                    finishedAt,
                    message: couldNotVerify
                      ? "Update command completed, but T3 Code could not verify the provider version."
                      : stillOutdated
                        ? "Update command completed, but T3 Code still detects an outdated provider version."
                        : "Provider updated.",
                    output: commandOutput(result),
                  }),
                );
              });

              return yield* run.pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    const failure = Cause.squash(cause);
                    const startedAt = yield* Ref.get(startedAtRef);
                    return yield* finish(
                      makeUpdateState({
                        status: "failed",
                        startedAt,
                        finishedAt: new Date().toISOString(),
                        message:
                          failure instanceof Error ? failure.message : "Update command failed.",
                        output: null,
                      }),
                    );
                  }),
                ),
              );
            }),
          })
          .pipe(
            Effect.mapError((error) =>
              Schema.is(ServerProviderUpdateError)(error)
                ? new ServerProviderUpdateError({
                    provider,
                    reason: error.reason,
                  })
                : error,
            ),
          );
      });

    return {
      updateProvider,
    } satisfies ProviderMaintenanceRunnerShape;
  });
}
