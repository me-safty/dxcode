import { Effect, Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString, TurnId } from "./baseSchemas";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "./orchestration";

export const ExecutionRunId = TrimmedNonEmptyString;
export type ExecutionRunId = typeof ExecutionRunId.Type;

export const ControlThreadExternalId = TrimmedNonEmptyString;
export type ControlThreadExternalId = typeof ControlThreadExternalId.Type;

export const ExecutionRunLifecycleType = Schema.Literals([
  "started",
  "completed",
  "failed",
  "interrupted",
]);
export type ExecutionRunLifecycleType = typeof ExecutionRunLifecycleType.Type;

export const ExecutionRunCreateRequest = Schema.Struct({
  controlThreadId: ControlThreadExternalId,
  executionRunId: ExecutionRunId,
  initialPrompt: Schema.String,
  workspaceRoot: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
});
export type ExecutionRunCreateRequest = typeof ExecutionRunCreateRequest.Type;

export const ExecutionRunCreateResponse = Schema.Struct({
  controlThreadId: ControlThreadExternalId,
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
  acceptedAt: IsoDateTime,
});
export type ExecutionRunCreateResponse = typeof ExecutionRunCreateResponse.Type;

export const ExecutionRunLifecycleEvent = Schema.Struct({
  eventId: TrimmedNonEmptyString,
  controlThreadId: ControlThreadExternalId,
  executionRunId: ExecutionRunId,
  type: ExecutionRunLifecycleType,
  occurredAt: IsoDateTime,
  t3ThreadId: Schema.optional(ThreadId),
  t3TurnId: Schema.optional(TurnId),
  failureSummary: Schema.optional(TrimmedNonEmptyString),
});
export type ExecutionRunLifecycleEvent = typeof ExecutionRunLifecycleEvent.Type;

export const ExecutionRunStatusQuery = Schema.Struct({
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
});
export type ExecutionRunStatusQuery = typeof ExecutionRunStatusQuery.Type;

export const ExecutionRunStatusResponse = Schema.Struct({
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
  sessionStatus: TrimmedNonEmptyString,
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  found: Schema.Boolean,
});
export type ExecutionRunStatusResponse = typeof ExecutionRunStatusResponse.Type;

export const ExecutionRunContinueRequest = Schema.Struct({
  controlThreadId: ControlThreadExternalId,
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
  prompt: Schema.String,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
});
export type ExecutionRunContinueRequest = typeof ExecutionRunContinueRequest.Type;

export const ExecutionRunContinueResponse = Schema.Struct({
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
  acceptedAt: IsoDateTime,
});
export type ExecutionRunContinueResponse = typeof ExecutionRunContinueResponse.Type;

export const ExecutionRunInterruptRequest = Schema.Struct({
  controlThreadId: ControlThreadExternalId,
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
});
export type ExecutionRunInterruptRequest = typeof ExecutionRunInterruptRequest.Type;

export const ExecutionRunInterruptResponse = Schema.Struct({
  executionRunId: ExecutionRunId,
  t3ThreadId: ThreadId,
  acceptedAt: IsoDateTime,
});
export type ExecutionRunInterruptResponse = typeof ExecutionRunInterruptResponse.Type;
