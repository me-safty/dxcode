import type { SandboxFailureKind, SandboxId, SandboxProviderKind } from "@t3tools/contracts";
import { Schema } from "effect";

export const SandboxOperation = Schema.Literals([
  "materialize",
  "reconnect",
  "status",
  "archive",
  "terminate",
]);
export type SandboxOperation = typeof SandboxOperation.Type;

const RETRYABLE_FAILURE_KINDS = new Set<SandboxFailureKind>([
  "provider_unavailable",
  "capacity_exhausted",
  "snapshot_failed",
  "service_failed",
  "runtime_failed",
  "timeout",
  "unknown",
]);

export class SandboxError extends Schema.TaggedErrorClass<SandboxError>()("SandboxError", {
  kind: Schema.Literals([
    "provider_unavailable",
    "capacity_exhausted",
    "auth_failed",
    "snapshot_failed",
    "worktree_failed",
    "service_failed",
    "runtime_failed",
    "timeout",
    "invalid_request",
    "unknown",
  ]),
  operation: SandboxOperation,
  message: Schema.String,
  retryable: Schema.Boolean,
  providerKind: Schema.optional(Schema.Literals(["local", "modal"])),
  sandboxId: Schema.optional(Schema.String),
}) {}

export function isRetryableSandboxFailureKind(kind: SandboxFailureKind): boolean {
  return RETRYABLE_FAILURE_KINDS.has(kind);
}

export function isRetryableSandboxError(error: SandboxError): boolean {
  return error.retryable;
}

export function makeSandboxError(input: {
  readonly kind: SandboxFailureKind;
  readonly operation: SandboxOperation;
  readonly message: string;
  readonly retryable?: boolean;
  readonly providerKind?: SandboxProviderKind;
  readonly sandboxId?: SandboxId;
}): SandboxError {
  return new SandboxError({
    kind: input.kind,
    operation: input.operation,
    message: input.message,
    retryable: input.retryable ?? isRetryableSandboxFailureKind(input.kind),
    ...(input.providerKind !== undefined ? { providerKind: input.providerKind } : {}),
    ...(input.sandboxId !== undefined ? { sandboxId: input.sandboxId } : {}),
  });
}

export function classifySandboxFailureKind(error: unknown): SandboxFailureKind {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  const text = `${error.name} ${error.message}`.toLowerCase();
  if (text.includes("auth") || text.includes("permission") || text.includes("credential")) {
    return "auth_failed";
  }
  if (text.includes("capacity") || text.includes("quota") || text.includes("rate limit")) {
    return "capacity_exhausted";
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (text.includes("invalid") || text.includes("validation")) {
    return "invalid_request";
  }
  if (text.includes("snapshot")) {
    return "snapshot_failed";
  }
  if (text.includes("service") || text.includes("health")) {
    return "service_failed";
  }
  if (text.includes("worktree") || text.includes("git")) {
    return "worktree_failed";
  }
  if (text.includes("runtime") || text.includes("process")) {
    return "runtime_failed";
  }
  if (text.includes("unavailable") || text.includes("network")) {
    return "provider_unavailable";
  }

  return "unknown";
}

export function sandboxErrorFromUnknown(
  error: unknown,
  input: {
    readonly operation: SandboxOperation;
    readonly providerKind?: SandboxProviderKind;
    readonly sandboxId?: SandboxId;
    readonly fallbackMessage?: string;
  },
): SandboxError {
  const kind = classifySandboxFailureKind(error);
  return makeSandboxError({
    kind,
    operation: input.operation,
    message: error instanceof Error ? error.message : (input.fallbackMessage ?? "Sandbox failed."),
    ...(input.providerKind !== undefined ? { providerKind: input.providerKind } : {}),
    ...(input.sandboxId !== undefined ? { sandboxId: input.sandboxId } : {}),
  });
}
