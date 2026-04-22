import {
  ServerProviderUpdateError,
  type ProviderDriverKind,
  type ServerProviderUpdatedPayload,
  type ServerProviderUpdateState,
} from "@t3tools/contracts";
import { Cause, Effect, Ref } from "effect";

import type { ProcessRunResult } from "../processRunner.ts";
import { runProcess } from "../processRunner.ts";
import type { ProviderRegistryShape } from "./Services/ProviderRegistry.ts";
import { getProviderVersionLifecycle } from "./providerVersionLifecycle.ts";

const UPDATE_TIMEOUT_MS = 5 * 60_000;
const UPDATE_OUTPUT_MAX_BYTES = 10_000;

export type ProviderUpdateRunner = (
  command: string,
  args: ReadonlyArray<string>,
) => Promise<ProcessRunResult>;

export interface ProviderUpdaterShape {
  readonly updateProvider: (
    provider: ProviderDriverKind,
  ) => Effect.Effect<ServerProviderUpdatedPayload, ServerProviderUpdateError>;
}

const defaultRunner: ProviderUpdateRunner = (command, args) =>
  runProcess(command, args, {
    timeoutMs: UPDATE_TIMEOUT_MS,
    maxBufferBytes: UPDATE_OUTPUT_MAX_BYTES,
    outputMode: "truncate",
    allowNonZeroExit: true,
  });

function trimNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function commandOutput(result: ProcessRunResult): string | null {
  const output = trimNullable([result.stderr, result.stdout].filter(Boolean).join("\n\n"));
  if (!output) {
    return null;
  }
  return truncateText(output, UPDATE_OUTPUT_MAX_BYTES);
}

function failureMessage(result: ProcessRunResult): string {
  if (result.timedOut) {
    return "Update timed out.";
  }
  if (result.code !== null && result.code !== 0) {
    return `Update command exited with code ${result.code}.`;
  }
  if (result.signal) {
    return `Update command ended with signal ${result.signal}.`;
  }
  return "Update command failed.";
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

export const makeProviderUpdater = Effect.fn("makeProviderUpdater")(function* (input: {
  readonly providerRegistry: ProviderRegistryShape;
  readonly runUpdate?: ProviderUpdateRunner;
}) {
  const runningProvidersRef = yield* Ref.make<ReadonlySet<ProviderDriverKind>>(new Set());
  const runUpdate = input.runUpdate ?? defaultRunner;

  const acquireProvider = Effect.fn("acquireProvider")(function* (provider: ProviderDriverKind) {
    return yield* Ref.modify(runningProvidersRef, (runningProviders) => {
      if (runningProviders.has(provider)) {
        return [false, runningProviders] as const;
      }
      const next = new Set(runningProviders);
      next.add(provider);
      return [true, next] as const;
    });
  });

  const releaseProvider = (provider: ProviderDriverKind) =>
    Ref.update(runningProvidersRef, (runningProviders) => {
      const next = new Set(runningProviders);
      next.delete(provider);
      return next;
    });

  const refreshProviders = (provider: ProviderDriverKind) =>
    input.providerRegistry.refresh(provider).pipe(Effect.map((providers) => ({ providers })));

  const updateProvider: ProviderUpdaterShape["updateProvider"] = (provider) =>
    Effect.gen(function* () {
      const lifecycle = getProviderVersionLifecycle(provider);
      const updateExecutable = lifecycle.updateExecutable;
      if (!updateExecutable) {
        return yield* new ServerProviderUpdateError({
          provider,
          reason: "This provider does not support one-click updates.",
        });
      }

      const acquired = yield* acquireProvider(provider);
      if (!acquired) {
        return yield* new ServerProviderUpdateError({
          provider,
          reason: "An update is already running for this provider.",
        });
      }

      const startedAt = new Date().toISOString();
      yield* input.providerRegistry.setProviderUpdateState(
        provider,
        makeUpdateState({
          status: "running",
          startedAt,
          finishedAt: null,
          message: "Updating provider.",
        }),
      );

      const finish = (state: ServerProviderUpdateState) =>
        input.providerRegistry
          .setProviderUpdateState(provider, state)
          .pipe(Effect.flatMap(() => refreshProviders(provider)));

      const run = Effect.promise(() => runUpdate(updateExecutable, lifecycle.updateArgs));

      return yield* run.pipe(
        Effect.flatMap((result) => {
          const finishedAt = new Date().toISOString();
          const succeeded = !result.timedOut && result.code === 0;
          return finish(
            makeUpdateState({
              status: succeeded ? "succeeded" : "failed",
              startedAt,
              finishedAt,
              message: succeeded ? "Provider updated." : failureMessage(result),
              output: commandOutput(result),
            }),
          );
        }),
        Effect.catchCause((cause) => {
          const failure = Cause.squash(cause);
          return finish(
            makeUpdateState({
              status: "failed",
              startedAt,
              finishedAt: new Date().toISOString(),
              message: failure instanceof Error ? failure.message : "Update command failed.",
              output: null,
            }),
          );
        }),
        Effect.ensuring(releaseProvider(provider)),
      );
    });

  return {
    updateProvider,
  } satisfies ProviderUpdaterShape;
});
