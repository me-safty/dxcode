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

export const ExecutionRunLifecycleType = Schema.Literals(["started", "completed", "failed"]);
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
