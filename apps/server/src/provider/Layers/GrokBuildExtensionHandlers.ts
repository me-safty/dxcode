import {
  type ApprovalRequestId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  emitDedupedAcpPlanUpdate,
  type AcpPlanUpdateFingerprintState,
} from "../acp/AcpSessionEventSupport.ts";
import type { AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime.ts";
import { bridgeAcpUserInputRequest, type PendingAcpUserInput } from "../acp/AcpUserInputBridge.ts";
import {
  CursorAskQuestionRequest,
  CursorCreatePlanRequest,
  CursorUpdateTodosRequest,
  extractAskQuestions,
  extractPlanMarkdown,
  extractTodosAsPlan,
} from "../acp/CursorAcpExtension.ts";
import {
  extractXAiAskUserQuestions,
  makeXAiAskUserQuestionCancelledResponse,
  makeXAiAskUserQuestionResponse,
  XAiAskUserQuestionRequest,
} from "../acp/XAiAcpExtension.ts";

interface GrokBuildExtensionContext extends AcpPlanUpdateFingerprintState {
  readonly threadId: ThreadId;
  readonly activeTurnId: TurnId | undefined;
}

type RuntimeEventStamp = Pick<ProviderRuntimeEvent, "createdAt" | "eventId">;

export function registerGrokBuildExtensionHandlers<E>(input: {
  readonly acp: AcpSessionRuntimeShape;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingAcpUserInput>;
  readonly nextRequestId: Effect.Effect<ApprovalRequestId, E>;
  readonly getContext: () => GrokBuildExtensionContext | undefined;
  readonly makeEventStamp: () => Effect.Effect<RuntimeEventStamp, E>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative: (method: string, payload: unknown) => Effect.Effect<void, E>;
  readonly encodePlanPayload: (payload: unknown) => string | undefined;
}): Effect.Effect<void> {
  const mapExtensionFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new EffectAcpErrors.AcpTransportError({
            detail: "Failed to process Grok Build ACP extension event.",
            cause,
          }),
      ),
    );
  const activeTurnId = () => input.getContext()?.activeTurnId;

  return Effect.gen(function* () {
    yield* input.acp.handleExtRequest("cursor/ask_question", CursorAskQuestionRequest, (params) =>
      mapExtensionFailure(
        Effect.gen(function* () {
          yield* input.logNative("cursor/ask_question", params);
          return yield* bridgeAcpUserInputRequest({
            provider: input.provider,
            threadId: input.threadId,
            turnId: activeTurnId,
            method: "cursor/ask_question",
            source: "acp.jsonrpc",
            params,
            pendingUserInputs: input.pendingUserInputs,
            nextRequestId: input.nextRequestId,
            makeEventStamp: input.makeEventStamp,
            offerRuntimeEvent: input.offerRuntimeEvent,
            extractQuestions: extractAskQuestions,
            makeResponse: (_params, resolution) => ({
              answers: resolution._tag === "answered" ? resolution.answers : {},
            }),
          });
        }),
      ),
    );

    yield* Effect.forEach(
      ["x.ai/ask_user_question", "_x.ai/ask_user_question"] as const,
      (method) =>
        input.acp.handleExtRequest(method, XAiAskUserQuestionRequest, (params) =>
          mapExtensionFailure(
            Effect.gen(function* () {
              yield* input.logNative(method, params);
              return yield* bridgeAcpUserInputRequest({
                provider: input.provider,
                threadId: input.threadId,
                turnId: activeTurnId,
                method,
                source: "acp.grok.extension",
                params,
                pendingUserInputs: input.pendingUserInputs,
                nextRequestId: input.nextRequestId,
                makeEventStamp: input.makeEventStamp,
                offerRuntimeEvent: input.offerRuntimeEvent,
                extractQuestions: extractXAiAskUserQuestions,
                includeRawOnResolved: true,
                makeResponse: (request, resolution) =>
                  resolution._tag === "answered"
                    ? makeXAiAskUserQuestionResponse(request, resolution.answers)
                    : makeXAiAskUserQuestionCancelledResponse(),
              });
            }),
          ),
        ),
      { discard: true },
    );

    yield* input.acp.handleExtRequest("cursor/create_plan", CursorCreatePlanRequest, (params) =>
      mapExtensionFailure(
        Effect.gen(function* () {
          yield* input.logNative("cursor/create_plan", params);
          yield* input.offerRuntimeEvent({
            type: "turn.proposed.completed",
            ...(yield* input.makeEventStamp()),
            provider: input.provider,
            threadId: input.threadId,
            turnId: activeTurnId(),
            payload: { planMarkdown: extractPlanMarkdown(params) },
            raw: {
              source: "acp.jsonrpc",
              method: "cursor/create_plan",
              payload: params,
            },
          });
          return { accepted: true } as const;
        }),
      ),
    );

    yield* input.acp.handleExtNotification(
      "cursor/update_todos",
      CursorUpdateTodosRequest,
      (params) =>
        mapExtensionFailure(
          Effect.gen(function* () {
            yield* input.logNative("cursor/update_todos", params);
            const context = input.getContext();
            if (!context) {
              return;
            }
            yield* emitDedupedAcpPlanUpdate({
              provider: input.provider,
              context,
              stamp: yield* input.makeEventStamp(),
              planState: context,
              payload: extractTodosAsPlan(params),
              rawPayload: params,
              source: "acp.jsonrpc",
              method: "cursor/update_todos",
              encodePlanPayload: input.encodePlanPayload,
              offerRuntimeEvent: input.offerRuntimeEvent,
            });
          }),
        ),
    );
  });
}
