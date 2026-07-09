import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProviderProjectCapabilitiesError } from "./Errors.ts";

const PROJECT_CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;

export class ProviderProjectCapabilitiesProbeTimeoutError extends Data.TaggedError(
  "ProviderProjectCapabilitiesProbeTimeoutError",
)<{
  readonly timeoutMs: number;
}> {
  override get message(): string {
    return `Provider project capability probe timed out after ${this.timeoutMs}ms.`;
  }
}

function describeCapabilityProbeFailure(cause: unknown): string {
  if (
    cause &&
    typeof cause === "object" &&
    "detail" in cause &&
    typeof cause.detail === "string" &&
    cause.detail.trim().length > 0
  ) {
    return cause.detail;
  }
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string" &&
    cause.message.trim().length > 0
  ) {
    return cause.message;
  }
  return "Provider project capability probe failed.";
}

export function withProviderProjectCapabilitiesTimeout<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ProviderProjectCapabilitiesProbeTimeoutError, R> {
  return effect.pipe(
    Effect.timeoutOption(Duration.millis(PROJECT_CAPABILITIES_PROBE_TIMEOUT_MS)),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new ProviderProjectCapabilitiesProbeTimeoutError({
              timeoutMs: PROJECT_CAPABILITIES_PROBE_TIMEOUT_MS,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
}

export function makeProviderProjectCapabilitiesError(input: {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
  readonly cause: unknown;
}): ProviderProjectCapabilitiesError {
  return new ProviderProjectCapabilitiesError({
    provider: input.provider,
    instanceId: input.instanceId,
    cwd: input.cwd,
    detail: describeCapabilityProbeFailure(input.cause),
    cause: input.cause,
  });
}
