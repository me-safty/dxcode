import {
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationSession,
  type ProviderInstanceId,
  type ProviderSendTurnInput,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import {
  planProviderFallback,
  providerFallbackDisplayName,
  type ProviderFallbackFailure,
  type ProviderFallbackSkip,
} from "../provider/providerFallback.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export interface ProviderFallbackAttemptInput {
  readonly threadId: ThreadId;
  readonly currentInstanceId: ProviderInstanceId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly sendTurnInput: ProviderSendTurnInput;
  readonly failure: ProviderFallbackFailure;
  readonly requireCompatibleContinuation: boolean;
  readonly createdAt: string;
}

export interface ProviderFallbackAttemptResult {
  readonly switched: boolean;
  readonly skipped: ReadonlyArray<ProviderFallbackSkip>;
}

function formatFailure(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : String(error);
}

function sessionStatus(status: "connecting" | "ready" | "running" | "error" | "closed") {
  switch (status) {
    case "connecting":
      return "starting" as const;
    case "running":
      return "running" as const;
    case "error":
      return "error" as const;
    case "closed":
      return "stopped" as const;
    case "ready":
      return "ready" as const;
  }
}

export const attemptProviderFallback = Effect.fn("attemptProviderFallback")(function* (
  input: ProviderFallbackAttemptInput,
) {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery;
  const providerRegistry = yield* ProviderRegistry;
  const providerService = yield* ProviderService;
  const settingsService = yield* ServerSettingsService;

  const settings = yield* settingsService.getSettings;
  if (!settings.providerFallback.enabled) {
    return { switched: false, skipped: [] } satisfies ProviderFallbackAttemptResult;
  }

  const thread = Option.getOrUndefined(yield* projection.getThreadDetailById(input.threadId));
  if (!thread) return { switched: false, skipped: [] } satisfies ProviderFallbackAttemptResult;
  const project = Option.getOrUndefined(yield* projection.getProjectShellById(thread.projectId));
  const cwd = resolveThreadWorkspaceCwd({ thread, projects: project ? [project] : [] });
  const providers = yield* providerRegistry.getProviders;
  const currentProvider = providers.find(
    (provider) => provider.instanceId === input.currentInstanceId,
  );
  if (!currentProvider) {
    return { switched: false, skipped: [] } satisfies ProviderFallbackAttemptResult;
  }

  const plan = planProviderFallback({
    settings,
    providers,
    currentInstanceId: input.currentInstanceId,
    modelSelection: input.modelSelection,
    requireCompatibleContinuation: input.requireCompatibleContinuation,
  });
  const skipped: ProviderFallbackSkip[] = [...plan.skipped];
  const originalSession = (yield* providerService.listSessions()).find(
    (session) =>
      session.threadId === input.threadId && session.providerInstanceId === input.currentInstanceId,
  );
  let bindingChanged = false;

  const nextCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((id) => CommandId.make(`server:${tag}:${id}`)));
  const appendOutcomeActivity = (outcome: {
    readonly kind: "provider.fallback.failed" | "provider.fallback.succeeded";
    readonly summary: string;
    readonly tone: "error" | "info";
    readonly toInstanceId?: ProviderInstanceId;
    readonly toDisplayName?: string;
  }) =>
    Effect.all({ commandId: nextCommandId(outcome.kind), eventId: crypto.randomUUIDv4 }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        engine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: EventId.make(eventId),
            tone: outcome.tone,
            kind: outcome.kind,
            summary: outcome.summary,
            payload: {
              fromInstanceId: input.currentInstanceId,
              fromDisplayName: providerFallbackDisplayName(currentProvider),
              ...(outcome.toInstanceId ? { toInstanceId: outcome.toInstanceId } : {}),
              ...(outcome.toDisplayName ? { toDisplayName: outcome.toDisplayName } : {}),
              failureKind: input.failure.kind,
              detail: input.failure.message,
              skipped,
            },
            turnId: thread.session?.activeTurnId ?? null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  for (const candidate of plan.candidates) {
    const attempt = yield* Effect.gen(function* () {
      const started = yield* providerService.startSession(input.threadId, {
        threadId: input.threadId,
        provider: candidate.provider.driver,
        providerInstanceId: candidate.instanceId,
        ...(cwd ? { cwd } : {}),
        modelSelection: candidate.modelSelection,
        ...(input.requireCompatibleContinuation && originalSession?.resumeCursor !== undefined
          ? { resumeCursor: originalSession.resumeCursor }
          : {}),
        runtimeMode: input.runtimeMode,
      });
      bindingChanged = true;
      const turn = yield* providerService.sendTurn({
        ...input.sendTurnInput,
        modelSelection: candidate.modelSelection,
      });
      return { started, turn };
    }).pipe(Effect.result);

    if (attempt._tag === "Failure") {
      skipped.push({
        instanceId: candidate.instanceId,
        displayName: candidate.displayName,
        reason: formatFailure(attempt.failure),
      });
      continue;
    }

    const { started, turn } = attempt.success;
    yield* engine.dispatch({
      type: "thread.meta.update",
      commandId: yield* nextCommandId("provider-fallback-model"),
      threadId: input.threadId,
      modelSelection: candidate.modelSelection,
    });
    const session: OrchestrationSession = {
      threadId: input.threadId,
      status: "running",
      providerName: started.provider,
      providerInstanceId: candidate.instanceId,
      runtimeMode: input.runtimeMode,
      activeTurnId: turn.turnId,
      lastError: null,
      updatedAt: input.createdAt,
    };
    yield* engine.dispatch({
      type: "thread.session.set",
      commandId: yield* nextCommandId("provider-fallback-session"),
      threadId: input.threadId,
      session,
      createdAt: input.createdAt,
    });
    yield* appendOutcomeActivity({
      kind: "provider.fallback.succeeded",
      summary: `Switched to ${candidate.displayName}`,
      tone: "info",
      toInstanceId: candidate.instanceId,
      toDisplayName: candidate.displayName,
    });
    return { switched: true, skipped } satisfies ProviderFallbackAttemptResult;
  }

  if (bindingChanged) {
    if (originalSession) {
      const restored = yield* providerService
        .startSession(input.threadId, {
          threadId: input.threadId,
          provider: originalSession.provider,
          providerInstanceId: input.currentInstanceId,
          ...(cwd ? { cwd } : {}),
          modelSelection: input.modelSelection,
          ...(originalSession.resumeCursor !== undefined
            ? { resumeCursor: originalSession.resumeCursor }
            : {}),
          runtimeMode: input.runtimeMode,
        })
        .pipe(Effect.result);
      if (restored._tag === "Success") {
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: yield* nextCommandId("provider-fallback-restore"),
          threadId: input.threadId,
          session: {
            threadId: input.threadId,
            status: sessionStatus(restored.success.status),
            providerName: restored.success.provider,
            providerInstanceId: input.currentInstanceId,
            runtimeMode: input.runtimeMode,
            activeTurnId: null,
            lastError: input.failure.message,
            updatedAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });
      } else {
        skipped.push({
          instanceId: input.currentInstanceId,
          displayName: providerFallbackDisplayName(currentProvider),
          reason: `Could not restore the original instance: ${formatFailure(restored.failure)}`,
        });
      }
    } else {
      yield* providerService.stopSession({ threadId: input.threadId }).pipe(Effect.ignore);
    }
  }

  yield* appendOutcomeActivity({
    kind: "provider.fallback.failed",
    summary: "Automatic provider fallback failed",
    tone: "error",
  });
  return { switched: false, skipped } satisfies ProviderFallbackAttemptResult;
});
