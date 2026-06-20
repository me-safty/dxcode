import {
  type EventId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpToolCallEvent,
} from "./AcpCoreRuntimeEvents.ts";
import type { AcpParsedSessionEvent, AcpPlanUpdate } from "./AcpRuntimeModel.ts";

type AcpAdapterRawSource = "acp.jsonrpc" | `acp.${string}.extension`;

export interface AcpEventStamp {
  readonly eventId: EventId;
  readonly createdAt: string;
}

export interface AcpSessionEventContext {
  readonly threadId: ThreadId;
  readonly activeTurnId: TurnId | undefined;
}

export interface AcpPlanUpdateFingerprintState {
  lastPlanFingerprint: string | undefined;
}

export interface MapAcpParsedSessionEventInput {
  readonly event: AcpParsedSessionEvent;
  readonly provider: ProviderDriverKind;
  readonly context: AcpSessionEventContext;
  readonly stamp: AcpEventStamp;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly logNative?: (
    threadId: ThreadId,
    method: string,
    payload: unknown,
  ) => Effect.Effect<void>;
  readonly onModeChanged?: (input: { readonly modeId: string }) => Effect.Effect<void>;
  readonly planState?: AcpPlanUpdateFingerprintState;
  readonly encodePlanPayload?: (payload: unknown) => string | undefined;
  readonly planSource?: AcpAdapterRawSource;
  readonly planMethod?: string;
}

export function fingerprintAcpPlanUpdate(input: {
  readonly activeTurnId: TurnId | undefined;
  readonly payload: AcpPlanUpdate;
  readonly encodePayload: (payload: unknown) => string | undefined;
}): string {
  return `${input.activeTurnId ?? "no-turn"}:${input.encodePayload(input.payload) ?? "[unserializable payload]"}`;
}

export function emitDedupedAcpPlanUpdate(input: {
  readonly provider: ProviderDriverKind;
  readonly context: AcpSessionEventContext;
  readonly stamp: AcpEventStamp;
  readonly planState: AcpPlanUpdateFingerprintState;
  readonly payload: AcpPlanUpdate;
  readonly rawPayload: unknown;
  readonly source: AcpAdapterRawSource;
  readonly method: string;
  readonly encodePlanPayload: (payload: unknown) => string | undefined;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}): Effect.Effect<void> {
  const fingerprint = fingerprintAcpPlanUpdate({
    activeTurnId: input.context.activeTurnId,
    payload: input.payload,
    encodePayload: input.encodePlanPayload,
  });
  if (input.planState.lastPlanFingerprint === fingerprint) {
    return Effect.void;
  }
  input.planState.lastPlanFingerprint = fingerprint;
  return input.offerRuntimeEvent(
    makeAcpPlanUpdatedEvent({
      stamp: input.stamp,
      provider: input.provider,
      threadId: input.context.threadId,
      turnId: input.context.activeTurnId,
      payload: input.payload,
      source: input.source,
      method: input.method,
      rawPayload: input.rawPayload,
    }),
  );
}

export function mapAcpParsedSessionEvent(
  input: MapAcpParsedSessionEventInput,
): Effect.Effect<void> {
  const { event, provider, context, stamp, offerRuntimeEvent } = input;
  switch (event._tag) {
    case "ModeChanged":
      return input.onModeChanged ? input.onModeChanged({ modeId: event.modeId }) : Effect.void;
    case "AssistantItemStarted":
      return offerRuntimeEvent(
        makeAcpAssistantItemEvent({
          stamp,
          provider,
          threadId: context.threadId,
          turnId: context.activeTurnId,
          itemId: event.itemId,
          lifecycle: "item.started",
        }),
      );
    case "AssistantItemCompleted":
      return offerRuntimeEvent(
        makeAcpAssistantItemEvent({
          stamp,
          provider,
          threadId: context.threadId,
          turnId: context.activeTurnId,
          itemId: event.itemId,
          lifecycle: "item.completed",
        }),
      );
    case "PlanUpdated":
      return Effect.gen(function* () {
        if (input.logNative) {
          yield* input.logNative(context.threadId, "session/update", event.rawPayload);
        }
        if (!input.planState || !input.encodePlanPayload) {
          return;
        }
        yield* emitDedupedAcpPlanUpdate({
          provider,
          context,
          stamp,
          planState: input.planState,
          payload: event.payload,
          rawPayload: event.rawPayload,
          source: input.planSource ?? "acp.jsonrpc",
          method: input.planMethod ?? "session/update",
          encodePlanPayload: input.encodePlanPayload,
          offerRuntimeEvent,
        });
      });
    case "ToolCallUpdated":
      return Effect.gen(function* () {
        if (input.logNative) {
          yield* input.logNative(context.threadId, "session/update", event.rawPayload);
        }
        yield* offerRuntimeEvent(
          makeAcpToolCallEvent({
            stamp,
            provider,
            threadId: context.threadId,
            turnId: context.activeTurnId,
            toolCall: event.toolCall,
            rawPayload: event.rawPayload,
          }),
        );
      });
    case "ContentDelta":
      return Effect.gen(function* () {
        if (input.logNative) {
          yield* input.logNative(context.threadId, "session/update", event.rawPayload);
        }
        yield* offerRuntimeEvent(
          makeAcpContentDeltaEvent({
            stamp,
            provider,
            threadId: context.threadId,
            turnId: context.activeTurnId,
            ...(event.itemId ? { itemId: event.itemId } : {}),
            text: event.text,
            rawPayload: event.rawPayload,
          }),
        );
      });
    default:
      return Effect.void;
  }
}
