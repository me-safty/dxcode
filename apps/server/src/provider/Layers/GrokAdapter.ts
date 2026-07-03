import { type GrokSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/schema";

import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import {
  acpPromptSettlementBelongsToContext,
  handleAcpUserInputRequest,
} from "../acp/AcpAdapterRuntime.ts";
import { makeAcpAdapterLive, type AcpAdapterLiveOptions } from "../acp/AcpAdapterLive.ts";
import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  makeGrokAcpRuntime,
  resolveGrokAcpBaseModelId,
} from "../acp/GrokAcpSupport.ts";
import {
  extractXAiAskUserQuestions,
  makeXAiAskUserQuestionCancelledResponse,
  makeXAiAskUserQuestionResponse,
  promptResponseHasMissingXAiStopReason,
  XAiAskUserQuestionRequest,
  type XAiAskUserQuestionResponse,
} from "../acp/XAiAcpExtension.ts";
import { ProviderAdapterProcessError } from "../Errors.ts";
import { type EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("grok");
const GROK_RESUME_VERSION = 1 as const;

export interface GrokAdapterLiveOptions extends AcpAdapterLiveOptions {
  readonly nativeEventLogger?: EventNdjsonLogger;
}

export const grokPromptSettlementBelongsToContext = acpPromptSettlementBelongsToContext;

export function makeGrokAdapter(grokSettings: GrokSettings, options?: GrokAdapterLiveOptions) {
  return Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    return yield* makeAcpAdapterLive<XAiAskUserQuestionResponse>(
      {
        provider: PROVIDER,
        providerLabel: "Grok",
        resumeSchemaVersion: GROK_RESUME_VERSION,
        readyReason: "Grok ACP session ready",
        respondToUserInputMethod: "_x.ai/ask_user_question",
        capabilities: { sessionModelSwitch: "in-session" },
        completedStopReasonFromPromptResponse: (response: EffectAcpSchema.PromptResponse) =>
          promptResponseHasMissingXAiStopReason(response) ? null : response.stopReason,
        makeAcpRuntime: (input) =>
          makeGrokAcpRuntime({
            grokSettings,
            ...(options?.environment ? { environment: options.environment } : {}),
            childProcessSpawner,
            cwd: input.cwd,
            ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
            clientInfo: { name: "t3-code", version: "0.0.0" },
            ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
            ...input.acpNativeLoggers,
          }).pipe(
            Effect.provideService(Scope.Scope, input.sessionScope),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          ),
        registerAcpCallbacks: (input) =>
          Effect.forEach(
            ["x.ai/ask_user_question", "_x.ai/ask_user_question"] as const,
            (method) =>
              input.acp.handleExtRequest(method, XAiAskUserQuestionRequest, (params) =>
                input.mapAcpCallbackFailure(
                  handleAcpUserInputRequest({
                    provider: PROVIDER,
                    threadId: input.threadId,
                    method,
                    source: "acp.grok.extension",
                    request: params,
                    prompt: {
                      questions: extractXAiAskUserQuestions(params),
                      makeResponse: (answers) => makeXAiAskUserQuestionResponse(params, answers),
                      makeCancelledResponse: makeXAiAskUserQuestionCancelledResponse,
                    },
                    pendingUserInputs: input.pendingUserInputs,
                    resolveTurnId: input.resolveActiveTurnId,
                    makeRequestId: input.nextApprovalRequestId,
                    makeEventStamp: input.makeEventStamp,
                    offerRuntimeEvent: input.offerRuntimeEvent,
                    logNative: input.logNative,
                  }),
                ),
              ),
            { discard: true },
          ),
        bindSessionModel: (input) =>
          Effect.gen(function* () {
            const requestedStartModelId = input.modelSelection?.model
              ? resolveGrokAcpBaseModelId(input.modelSelection.model)
              : undefined;
            const boundModelId = yield* applyGrokAcpModelSelection({
              runtime: input.acp,
              currentModelId: currentGrokModelIdFromSessionSetup(input.sessionSetupResult),
              requestedModelId: requestedStartModelId,
              mapError: (cause) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/set_model", cause),
            });
            return {
              currentModelId: boundModelId,
              displayModel: boundModelId ? resolveGrokAcpBaseModelId(boundModelId) : undefined,
            };
          }),
        prepareTurnModel: (input) =>
          Effect.gen(function* () {
            const requestedTurnModelId = input.modelSelection?.model
              ? resolveGrokAcpBaseModelId(input.modelSelection.model)
              : undefined;
            const currentModelId = yield* applyGrokAcpModelSelection({
              runtime: input.ctx.acp,
              currentModelId: input.ctx.currentModelId,
              requestedModelId: requestedTurnModelId,
              mapError: (cause) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/set_model", cause),
            });
            return {
              currentModelId,
              displayModel: currentModelId ? resolveGrokAcpBaseModelId(currentModelId) : undefined,
            };
          }),
      },
      options,
    );
  });
}
