import type {
  TaskRuntimeArchiveRequest,
  TaskRuntimeArchiveResponse,
  TaskRuntimeMaterializeRequest,
  TaskRuntimeMaterializeResponse,
  TaskRuntimeReconnectRequest,
  TaskRuntimeReconnectResponse,
  TaskRuntimeSandboxStatusQuery,
  TaskRuntimeSandboxStatusResponse,
} from "@t3tools/contracts";
import { Context, Data } from "effect";
import type { Effect } from "effect";

export type SandboxRuntimeOperation = "materialize" | "reconnect" | "archive" | "status";

export class SandboxRuntimeError extends Data.TaggedError("SandboxRuntimeError")<{
  readonly operation: SandboxRuntimeOperation;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function sandboxRuntimeErrorFromUnknown(
  error: unknown,
  operation: SandboxRuntimeOperation,
): SandboxRuntimeError {
  if (error instanceof SandboxRuntimeError) {
    return error;
  }

  return new SandboxRuntimeError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export interface SandboxRuntimeShape {
  readonly materializeTaskRuntime: (
    request: TaskRuntimeMaterializeRequest,
  ) => Effect.Effect<TaskRuntimeMaterializeResponse, SandboxRuntimeError>;
  readonly reconnectTaskRuntime: (
    request: TaskRuntimeReconnectRequest,
  ) => Effect.Effect<TaskRuntimeReconnectResponse, SandboxRuntimeError>;
  readonly archiveTaskRuntime: (
    request: TaskRuntimeArchiveRequest,
  ) => Effect.Effect<TaskRuntimeArchiveResponse, SandboxRuntimeError>;
  readonly getTaskRuntimeStatus: (
    request: TaskRuntimeSandboxStatusQuery,
  ) => Effect.Effect<TaskRuntimeSandboxStatusResponse, SandboxRuntimeError>;
}

export class SandboxRuntime extends Context.Service<SandboxRuntime, SandboxRuntimeShape>()(
  "t3/sandbox/Services/SandboxRuntime",
) {}
