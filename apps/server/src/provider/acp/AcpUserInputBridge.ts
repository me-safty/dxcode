import {
  ApprovalRequestId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  type RuntimeEventRawSource,
  RuntimeRequestId,
  type ThreadId,
  type TurnId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

export type AcpUserInputResolution =
  | { readonly _tag: "answered"; readonly answers: ProviderUserInputAnswers }
  | { readonly _tag: "cancelled" };

export interface PendingAcpUserInput {
  readonly resolution: Deferred.Deferred<AcpUserInputResolution>;
}

type UserInputRequestedEvent = Extract<
  ProviderRuntimeEvent,
  { readonly type: "user-input.requested" }
>;
type RuntimeEventStamp = Pick<UserInputRequestedEvent, "createdAt" | "eventId">;

export function settlePendingAcpUserInputsAsCancelled(
  pendingUserInputs: ReadonlyMap<ApprovalRequestId, PendingAcpUserInput>,
): Effect.Effect<void> {
  return Effect.forEach(
    pendingUserInputs.values(),
    (pending) => Deferred.succeed(pending.resolution, { _tag: "cancelled" }).pipe(Effect.ignore),
    { discard: true },
  );
}

export function answerPendingAcpUserInput(
  pending: PendingAcpUserInput,
  answers: ProviderUserInputAnswers,
): Effect.Effect<void> {
  return Deferred.succeed(pending.resolution, { _tag: "answered", answers }).pipe(Effect.asVoid);
}

export function bridgeAcpUserInputRequest<Params, Response, E>(input: {
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: () => TurnId | undefined;
  readonly method: string;
  readonly source: RuntimeEventRawSource;
  readonly params: Params;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingAcpUserInput>;
  readonly nextRequestId: Effect.Effect<ApprovalRequestId, E>;
  readonly makeEventStamp: () => Effect.Effect<RuntimeEventStamp, E>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly extractQuestions: (params: Params) => ReadonlyArray<UserInputQuestion>;
  readonly makeResponse: (params: Params, resolution: AcpUserInputResolution) => Response;
  readonly includeRawOnResolved?: boolean;
}): Effect.Effect<Response, E> {
  return Effect.gen(function* () {
    const requestId = yield* input.nextRequestId;
    const runtimeRequestId = RuntimeRequestId.make(requestId);
    const resolution = yield* Deferred.make<AcpUserInputResolution>();
    input.pendingUserInputs.set(requestId, { resolution });
    return yield* Effect.gen(function* () {
      const raw = {
        source: input.source,
        method: input.method,
        payload: input.params,
      };

      yield* input.offerRuntimeEvent({
        type: "user-input.requested",
        ...(yield* input.makeEventStamp()),
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId(),
        requestId: runtimeRequestId,
        payload: { questions: input.extractQuestions(input.params) },
        raw,
      });

      const resolved = yield* Deferred.await(resolution);
      const resolvedAnswers = resolved._tag === "answered" ? resolved.answers : {};
      yield* input.offerRuntimeEvent({
        type: "user-input.resolved",
        ...(yield* input.makeEventStamp()),
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId(),
        requestId: runtimeRequestId,
        payload: { answers: resolvedAnswers },
        ...(input.includeRawOnResolved ? { raw } : {}),
      });

      return input.makeResponse(input.params, resolved);
    }).pipe(Effect.ensuring(Effect.sync(() => input.pendingUserInputs.delete(requestId))));
  });
}
