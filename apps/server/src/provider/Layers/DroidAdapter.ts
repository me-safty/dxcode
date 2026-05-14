import { randomUUID } from "node:crypto";
import {
  AutonomyLevel,
  createSession,
  DroidInteractionMode,
  DroidMessageType,
  ReasoningEffort,
  resumeSession,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type DroidMessage,
  type DroidSession,
  type RequestPermissionRequestParams,
} from "@factory/droid-sdk";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type CanonicalRequestType,
  type DroidSettings,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
  type RuntimeContentStreamKind,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  type ProviderAdapterError,
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("droid");

interface PendingPermission {
  readonly requestType: CanonicalRequestType;
  readonly resolve: (decision: ToolConfirmationOutcome) => void;
}

interface DroidContext {
  session: ProviderSession;
  readonly droid: DroidSession;
  readonly pendingPermissions: Map<ApprovalRequestId, PendingPermission>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeAbort: AbortController | undefined;
  activeAssistantItems: Set<string>;
}

export interface DroidAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

const nowIso = () => DateTime.formatIso(DateTime.nowUnsafe());
const eventId = () => EventId.make(randomUUID());

function updateContextSession(context: DroidContext, patch: Partial<ProviderSession>) {
  context.session = {
    ...context.session,
    ...patch,
    updatedAt: nowIso(),
  };
}

function toModelId(model: string | undefined): string | undefined {
  return !model || model === "default" ? undefined : model;
}

function toReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  switch (value) {
    case "low":
      return ReasoningEffort.Low;
    case "high":
      return ReasoningEffort.High;
    case "xhigh":
      return ReasoningEffort.ExtraHigh;
    case "medium":
      return ReasoningEffort.Medium;
    default:
      return undefined;
  }
}

function toAutonomyLevel(input: ProviderSessionStartInput): AutonomyLevel {
  switch (input.runtimeMode) {
    case "approval-required":
      return AutonomyLevel.Off;
    case "auto-accept-edits":
      return AutonomyLevel.Low;
    case "full-access":
      return AutonomyLevel.High;
  }
}

function toRequestType(params: RequestPermissionRequestParams): CanonicalRequestType {
  const type = params.toolUses[0]?.confirmationType;
  switch (type) {
    case ToolConfirmationType.Execute:
      return "command_execution_approval";
    case ToolConfirmationType.Edit:
    case ToolConfirmationType.Create:
    case ToolConfirmationType.ApplyPatch:
      return "file_change_approval";
    case ToolConfirmationType.McpTool:
      return "dynamic_tool_call";
    case ToolConfirmationType.AskUser:
      return "tool_user_input";
    default:
      return "unknown";
  }
}

function permissionDetail(params: RequestPermissionRequestParams): string {
  const first = params.toolUses[0];
  if (!first) return "Droid requested permission.";
  const details = first.details;
  switch (details.type) {
    case ToolConfirmationType.Execute:
      return details.fullCommand;
    case ToolConfirmationType.Edit:
    case ToolConfirmationType.Create:
    case ToolConfirmationType.ApplyPatch:
      return "filePath" in details ? details.filePath : "Droid requested a file change.";
    case ToolConfirmationType.McpTool:
      return details.toolName;
    default:
      return first.toolUse.name;
  }
}

function toOutcome(decision: ProviderApprovalDecision): ToolConfirmationOutcome {
  switch (decision) {
    case "accept":
      return ToolConfirmationOutcome.ProceedOnce;
    case "acceptForSession":
      return ToolConfirmationOutcome.ProceedAlways;
    case "decline":
    case "cancel":
      return ToolConfirmationOutcome.Cancel;
  }
}

export function makeDroidAdapter(settings: DroidSettings, options?: DroidAdapterOptions) {
  return Effect.gen(function* () {
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("droid");
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, DroidContext>();
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...options?.environment }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(
          contexts,
          (context) =>
            Effect.tryPromise(() => {
              context.activeAbort?.abort();
              return context.droid.close();
            }).pipe(Effect.ignore),
          { concurrency: "unbounded", discard: true },
        );
        yield* Queue.shutdown(runtimeEvents);
      }),
    );

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);
    const emitNow = (event: ProviderRuntimeEvent) => Effect.runPromise(emit(event));
    const eventBase = (
      context: DroidContext,
      input?: {
        turnId?: TurnId;
        itemId?: string;
        requestId?: string;
        raw?: unknown;
      },
    ) => ({
      eventId: eventId(),
      provider: PROVIDER,
      providerInstanceId: instanceId,
      threadId: context.session.threadId,
      createdAt: nowIso(),
      ...(input?.turnId ? { turnId: input.turnId } : {}),
      ...(input?.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
      ...(input?.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
      ...(input?.raw !== undefined
        ? { raw: { source: "droid.sdk.message" as const, payload: input.raw } }
        : {}),
    });

    type DroidAdapterShape = ProviderAdapterShape<ProviderAdapterError>;
    const startSession: DroidAdapterShape["startSession"] = Effect.fn("startDroidSession")(
      function* (input) {
        let contextRef: DroidContext | undefined;
        const permissionHandler = (params: RequestPermissionRequestParams) =>
          new Promise<ToolConfirmationOutcome>((resolve) => {
            const context = contextRef;
            if (!context) {
              resolve(ToolConfirmationOutcome.Cancel);
              return;
            }
            const requestId = ApprovalRequestId.make(`droid-${randomUUID()}`);
            const requestType = toRequestType(params);
            context.pendingPermissions.set(requestId, { requestType, resolve });
            void emitNow({
              ...eventBase(context, { requestId, raw: params }),
              raw: { source: "droid.sdk.permission", payload: params },
              type: "request.opened",
              payload: {
                requestType,
                detail: permissionDetail(params),
                args: params,
              },
            });
          });
        const modelSelection = input.modelSelection;
        const modelId = toModelId(modelSelection?.model);
        const sdkOptions = {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          execPath: settings.binaryPath,
          env,
          permissionHandler,
        };
        const reasoningEffort = toReasoningEffort(
          getModelSelectionStringOptionValue(modelSelection, "reasoningEffort"),
        );
        const droid = yield* Effect.tryPromise({
          try: () =>
            typeof input.resumeCursor === "string"
              ? resumeSession(input.resumeCursor, sdkOptions)
              : createSession({
                  ...sdkOptions,
                  ...(modelId ? { modelId } : {}),
                  autonomyLevel: toAutonomyLevel(input),
                  interactionMode: DroidInteractionMode.Auto,
                  ...(reasoningEffort ? { reasoningEffort } : {}),
                }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "createSession",
              detail: cause instanceof Error ? cause.message : "Failed to start Droid session.",
              cause,
            }),
        });
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: instanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          model: modelSelection?.model ?? "default",
          threadId: input.threadId,
          resumeCursor: droid.sessionId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        const context: DroidContext = {
          session,
          droid,
          pendingPermissions: new Map(),
          turns: [],
          activeAbort: undefined,
          activeAssistantItems: new Set(),
        };
        contextRef = context;
        sessions.set(input.threadId, context);

        yield* emit({
          ...eventBase(context),
          type: "session.started",
          payload: { message: "Droid SDK session started" },
        });
        yield* emit({
          ...eventBase(context),
          type: "thread.started",
          payload: { providerThreadId: droid.sessionId },
        });
        return session;
      },
    );

    const handleMessage = (context: DroidContext, turnId: TurnId, message: DroidMessage) => {
      const base = (itemId?: string) =>
        eventBase(context, { turnId, raw: message, ...(itemId ? { itemId } : {}) });
      switch (message.type) {
        case DroidMessageType.AssistantTextDelta:
        case DroidMessageType.ThinkingTextDelta: {
          const itemId = `${message.messageId}-${message.blockIndex}`;
          const streamKind: RuntimeContentStreamKind =
            message.type === DroidMessageType.AssistantTextDelta
              ? "assistant_text"
              : "reasoning_text";
          if (streamKind === "assistant_text") context.activeAssistantItems.add(itemId);
          return emitNow({
            ...base(itemId),
            type: "content.delta",
            payload: { streamKind, delta: message.text },
          });
        }
        case DroidMessageType.ToolUse:
          return emitNow({
            ...base(message.toolUseId),
            type: "item.started",
            payload: {
              itemType: "dynamic_tool_call",
              title: message.toolName,
              data: message.toolInput,
            },
          });
        case DroidMessageType.ToolResult:
          return emitNow({
            ...base(message.toolUseId),
            type: "item.completed",
            payload: {
              itemType: "dynamic_tool_call",
              title: message.toolName,
              detail: typeof message.content === "string" ? message.content : undefined,
            },
          });
        case DroidMessageType.Error:
          return emitNow({
            ...base(),
            type: "runtime.error",
            payload: { message: message.message, class: "provider_error" },
          });
        default:
          return Promise.resolve();
      }
    };

    const sendTurn: DroidAdapterShape["sendTurn"] = Effect.fn("sendDroidTurn")(function* (input) {
      const context = sessions.get(input.threadId);
      if (!context) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Unknown Droid thread: ${input.threadId}`,
        });
      }
      if ((input.attachments?.length ?? 0) > 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Droid SDK attachment bridging is not enabled in this WIP.",
        });
      }
      const text = input.input?.trim();
      if (!text) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Droid turns require text input.",
        });
      }

      const turnId = TurnId.make(`droid-turn-${randomUUID()}`);
      const abort = new AbortController();
      context.activeAbort = abort;
      context.activeAssistantItems = new Set();
      context.turns.push({ id: turnId, items: [] });
      updateContextSession(context, {
        status: "running",
        activeTurnId: turnId,
        model: input.modelSelection?.model ?? context.session.model,
      });

      yield* emit({
        ...eventBase(context, { turnId }),
        type: "turn.started",
        payload: { model: context.session.model },
      });

      yield* Effect.promise(async () => {
        try {
          if (input.interactionMode === "plan") {
            await context.droid.enterSpecMode();
          }
          const modelId = toModelId(input.modelSelection?.model);
          const reasoningEffort = toReasoningEffort(
            getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort"),
          );
          if (modelId || reasoningEffort) {
            await context.droid.updateSettings({
              ...(modelId ? { modelId } : {}),
              ...(reasoningEffort ? { reasoningEffort } : {}),
            });
          }
          for await (const message of context.droid.stream(text, { abortSignal: abort.signal })) {
            await handleMessage(context, turnId, message);
          }
          for (const itemId of context.activeAssistantItems) {
            await emitNow({
              ...eventBase(context, { turnId, itemId }),
              type: "item.completed",
              payload: { itemType: "assistant_message" },
            });
          }
          updateContextSession(context, { status: "ready", activeTurnId: undefined });
          await emitNow({
            ...eventBase(context, { turnId }),
            type: "turn.completed",
            payload: { state: "completed" },
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Droid turn failed.";
          updateContextSession(context, {
            status: "error",
            activeTurnId: undefined,
            lastError: message,
          });
          await emitNow({
            ...eventBase(context, { turnId }),
            type: "runtime.error",
            payload: { message, class: "provider_error" },
          });
          await emitNow({
            ...eventBase(context, { turnId }),
            type: "turn.completed",
            payload: { state: "failed", errorMessage: message },
          });
        }
      }).pipe(Effect.forkDetach);

      return { threadId: input.threadId, turnId, resumeCursor: context.droid.sessionId };
    });

    const stopSession = (threadId: ThreadId) =>
      Effect.promise(async () => {
        const context = sessions.get(threadId);
        if (!context) return;
        sessions.delete(threadId);
        context.activeAbort?.abort();
        await context.droid.close();
        await emitNow({
          ...eventBase(context),
          type: "session.exited",
          payload: { reason: "Session stopped", recoverable: false, exitKind: "graceful" },
        });
      });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn: (threadId) =>
        Effect.promise(async () => {
          const context = sessions.get(threadId);
          context?.activeAbort?.abort();
          await context?.droid.interrupt();
        }),
      respondToRequest: (threadId, requestId, decision) =>
        Effect.gen(function* () {
          const context = sessions.get(threadId);
          const pending = context?.pendingPermissions.get(requestId);
          if (!context || !pending) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "respondToRequest",
              detail: `Unknown pending Droid permission request: ${requestId}`,
            });
          }
          context.pendingPermissions.delete(requestId);
          pending.resolve(toOutcome(decision));
          yield* emit({
            ...eventBase(context, { requestId }),
            type: "request.resolved",
            payload: { requestType: pending.requestType, decision },
          });
        }),
      respondToUserInput: () => Effect.void,
      stopSession,
      listSessions: () => Effect.succeed([...sessions.values()].map((context) => context.session)),
      hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
      readThread: (threadId) =>
        Effect.succeed({ threadId, turns: sessions.get(threadId)?.turns ?? [] }),
      rollbackThread: (threadId) =>
        Effect.succeed({ threadId, turns: sessions.get(threadId)?.turns ?? [] }),
      stopAll: () =>
        Effect.forEach([...sessions.keys()], stopSession, {
          concurrency: "unbounded",
          discard: true,
        }),
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies DroidAdapterShape;
  });
}
