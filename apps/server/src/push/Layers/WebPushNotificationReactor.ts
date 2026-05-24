import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationThreadShell,
  ProviderRuntimeEvent,
  ServerPushNotificationPayload,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  WebPushNotificationReactor,
  type WebPushNotificationReactorShape,
} from "../Services/WebPushNotificationReactor.ts";
import { WebPushService } from "../Services/WebPushService.ts";

type NotificationEvent =
  | Extract<OrchestrationEvent, { type: "thread.activity-appended" | "thread.turn-diff-completed" }>
  | Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;

export type RuntimeContentTrackingEvent = Pick<
  ProviderRuntimeEvent,
  "eventId" | "itemId" | "threadId" | "turnId"
>;

interface RuntimeTurnNotificationContent {
  readonly contentByMessageKey: Map<string, string>;
  latestMessageKey: string | null;
}

export interface LatestProjectedThreadContent {
  readonly content: string | null;
  readonly turnId: TurnId | null;
  readonly streaming: boolean;
}

const TRACKED_RUNTIME_CONTENT_MAX_CHARS = 4_000;
const INTERRUPTED_ACTION_BODY = "Agent interrupted. Open Salchi to choose the next action.";
const THREAD_NOTIFICATION_DETAIL_PAGE = {
  limits: {
    messages: 1,
    proposedPlans: 1,
    activities: 1,
    checkpoints: 1,
  },
} as const;

function threadUrl(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

function notificationThreadId(event: NotificationEvent): ThreadId {
  return event.type === "turn.completed" ? event.threadId : event.payload.threadId;
}

function normalizeNotificationText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeManualStopReason(value: string | null | undefined): string | null {
  const normalized =
    normalizeNotificationText(value)
      ?.toLowerCase()
      .replace(/[.!]+$/g, "") ?? "";
  return normalized.length > 0 ? normalized : null;
}

function isManualStopReason(value: string | null | undefined): boolean {
  const normalized = normalizeManualStopReason(value);
  if (normalized === null) {
    return false;
  }
  return (
    normalized === "session stopped" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized.includes("user cancelled") ||
    normalized.includes("user canceled")
  );
}

function threadTurnKey(threadId: ThreadId, turnId: TurnId | undefined): string {
  return `${threadId}:${turnId ?? "unknown"}`;
}

function runtimeMessageKey(
  event: Pick<ProviderRuntimeEvent, "eventId" | "itemId" | "turnId">,
): string {
  if (event.itemId !== undefined) {
    return `item:${event.itemId}`;
  }
  if (event.turnId !== undefined) {
    return `turn:${event.turnId}`;
  }
  return `event:${event.eventId}`;
}

function truncateTrackedRuntimeContent(value: string): string {
  return value.length > TRACKED_RUNTIME_CONTENT_MAX_CHARS
    ? value.slice(0, TRACKED_RUNTIME_CONTENT_MAX_CHARS)
    : value;
}

function getOrCreateRuntimeTurnNotificationContent(
  existing: RuntimeTurnNotificationContent | undefined,
): RuntimeTurnNotificationContent {
  return (
    existing ?? {
      contentByMessageKey: new Map<string, string>(),
      latestMessageKey: null,
    }
  );
}

function appendTrackedRuntimeMessageContent(
  existing: RuntimeTurnNotificationContent | undefined,
  messageKey: string,
  delta: string,
): RuntimeTurnNotificationContent {
  const content = getOrCreateRuntimeTurnNotificationContent(existing);
  content.contentByMessageKey.set(
    messageKey,
    truncateTrackedRuntimeContent(`${content.contentByMessageKey.get(messageKey) ?? ""}${delta}`),
  );
  content.latestMessageKey = messageKey;
  return content;
}

function setTrackedRuntimeMessageContent(
  existing: RuntimeTurnNotificationContent | undefined,
  messageKey: string,
  text: string,
): RuntimeTurnNotificationContent {
  const content = getOrCreateRuntimeTurnNotificationContent(existing);
  content.contentByMessageKey.set(messageKey, truncateTrackedRuntimeContent(text));
  content.latestMessageKey = messageKey;
  return content;
}

function trackRuntimeContentDelta(
  runtimeContentByTurn: Map<string, RuntimeTurnNotificationContent>,
  event: RuntimeContentTrackingEvent,
  delta: string,
): void {
  const key = threadTurnKey(event.threadId, event.turnId);
  const messageKey = runtimeMessageKey(event);
  runtimeContentByTurn.set(
    key,
    appendTrackedRuntimeMessageContent(runtimeContentByTurn.get(key), messageKey, delta),
  );
}

function trackRuntimeMessageContent(
  runtimeContentByTurn: Map<string, RuntimeTurnNotificationContent>,
  event: RuntimeContentTrackingEvent,
  text: string,
): void {
  const key = threadTurnKey(event.threadId, event.turnId);
  const messageKey = runtimeMessageKey(event);
  runtimeContentByTurn.set(
    key,
    setTrackedRuntimeMessageContent(runtimeContentByTurn.get(key), messageKey, text),
  );
}

function takeTrackedRuntimeThreadContent(
  runtimeContentByTurn: Map<string, RuntimeTurnNotificationContent>,
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
): string | null {
  const key = threadTurnKey(event.threadId, event.turnId);
  const content = runtimeContentByTurn.get(key) ?? null;
  runtimeContentByTurn.delete(key);
  if (content?.latestMessageKey === null || content?.latestMessageKey === undefined) {
    return null;
  }
  return normalizeNotificationText(content.contentByMessageKey.get(content.latestMessageKey));
}

export function createRuntimeNotificationContentTrackerForTest() {
  const runtimeContentByTurn = new Map<string, RuntimeTurnNotificationContent>();
  return {
    appendDelta: (event: RuntimeContentTrackingEvent, delta: string) => {
      trackRuntimeContentDelta(runtimeContentByTurn, event, delta);
    },
    setMessage: (event: RuntimeContentTrackingEvent, text: string) => {
      trackRuntimeMessageContent(runtimeContentByTurn, event, text);
    },
    take: (event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>) =>
      takeTrackedRuntimeThreadContent(runtimeContentByTurn, event),
  };
}

function latestMessageNotificationContent(
  message: OrchestrationMessage | undefined,
): string | null {
  const text = normalizeNotificationText(message?.text);
  if (text !== null) {
    return text;
  }
  const attachmentCount = message?.attachments?.length ?? 0;
  if (attachmentCount === 1) {
    return "Image attachment";
  }
  if (attachmentCount > 1) {
    return `${attachmentCount} image attachments`;
  }
  return null;
}

function latestProjectedThreadContent(
  message: OrchestrationMessage | undefined,
): LatestProjectedThreadContent | null {
  if (message === undefined) {
    return null;
  }
  return {
    content: latestMessageNotificationContent(message),
    turnId: message.turnId,
    streaming: message.streaming,
  };
}

export function selectLatestThreadContentForTurnCompletion(input: {
  readonly event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
  readonly runtimeContent: string | null;
  readonly projectedContent: LatestProjectedThreadContent | null;
}): string | null {
  const projectedBody = normalizeNotificationText(input.projectedContent?.content);
  if (
    projectedBody !== null &&
    input.projectedContent !== null &&
    input.event.turnId !== undefined &&
    input.projectedContent.turnId === input.event.turnId &&
    !input.projectedContent.streaming
  ) {
    return projectedBody;
  }
  return normalizeNotificationText(input.runtimeContent) ?? projectedBody;
}

function fallbackNotificationContent(event: NotificationEvent): string | null {
  switch (event.type) {
    case "thread.activity-appended":
      return normalizeNotificationText(event.payload.activity.summary);

    case "thread.turn-diff-completed":
      return null;

    case "turn.completed":
      return "Agent turn completed";
  }
}

function turnCompletionNotificationBody(
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  latestThreadContent: string | null,
): string | null {
  switch (event.payload.state) {
    case "completed":
      return normalizeNotificationText(latestThreadContent) ?? "Agent turn completed";

    case "failed":
      return (
        normalizeNotificationText(event.payload.errorMessage) ??
        normalizeNotificationText(latestThreadContent) ??
        "Agent turn finished with errors"
      );

    case "cancelled":
      return null;

    case "interrupted":
      return isManualStopReason(event.payload.errorMessage) ||
        isManualStopReason(event.payload.stopReason)
        ? null
        : INTERRUPTED_ACTION_BODY;
  }
}

export function isManualStopTurnCompletion(
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  thread: Option.Option<OrchestrationThreadShell>,
): boolean {
  if (event.payload.state === "cancelled") {
    return true;
  }
  if (Option.isSome(thread) && thread.value.session?.status === "stopped") {
    return true;
  }
  return (
    event.payload.state === "interrupted" &&
    (isManualStopReason(event.payload.errorMessage) || isManualStopReason(event.payload.stopReason))
  );
}

export function shouldNotifyRuntimeTurnCompletion(
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  thread: Option.Option<OrchestrationThreadShell>,
): boolean {
  if (isManualStopTurnCompletion(event, thread)) {
    return false;
  }
  if (Option.isNone(thread)) {
    return true;
  }
  const activeTurnId = thread.value.session?.activeTurnId ?? null;
  return activeTurnId === null || event.turnId === undefined || activeTurnId === event.turnId;
}

export function deriveWebPushPayloadForEvent(input: {
  readonly event: NotificationEvent;
  readonly environmentId: EnvironmentId;
  readonly threadTitle: string;
  readonly latestThreadContent: string | null;
}): ServerPushNotificationPayload | null {
  const threadId = notificationThreadId(input.event);
  const url = threadUrl(input.environmentId, threadId);

  switch (input.event.type) {
    case "thread.activity-appended": {
      const activity = input.event.payload.activity;
      const body =
        normalizeNotificationText(input.latestThreadContent) ??
        fallbackNotificationContent(input.event);
      if (activity.kind === "approval.requested") {
        return {
          title: input.threadTitle,
          ...(body ? { body } : {}),
          url,
          tag: `thread:${input.event.payload.threadId}:approval:${activity.id}`,
        };
      }
      if (activity.kind === "user-input.requested") {
        return {
          title: input.threadTitle,
          ...(body ? { body } : {}),
          url,
          tag: `thread:${input.event.payload.threadId}:input:${activity.id}`,
        };
      }
      return null;
    }

    case "thread.turn-diff-completed":
      return null;

    case "turn.completed":
      const body = turnCompletionNotificationBody(input.event, input.latestThreadContent);
      if (body === null) {
        return null;
      }
      return {
        title: input.threadTitle,
        body,
        url,
        tag: `thread:${input.event.threadId}:turn:${input.event.turnId ?? input.event.eventId}`,
      };
  }
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const push = yield* WebPushService;
  const serverEnvironment = yield* ServerEnvironment;
  const runtimeContentByTurn = new Map<string, RuntimeTurnNotificationContent>();

  const resolveThread = (threadId: ThreadId) =>
    projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.catch(() => Effect.succeed(Option.none<OrchestrationThreadShell>())));

  const resolveLatestProjectedThreadContent = (threadId: ThreadId) =>
    projectionSnapshotQuery
      .getThreadDetailSnapshotById(threadId, THREAD_NOTIFICATION_DETAIL_PAGE)
      .pipe(
        Effect.map(
          Option.match({
            onNone: () => null,
            onSome: (snapshot) => latestProjectedThreadContent(snapshot.thread.messages.at(-1)),
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to resolve web push notification body", {
            threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );

  const takeRuntimeThreadContent = (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) =>
    Effect.sync(() => {
      return takeTrackedRuntimeThreadContent(runtimeContentByTurn, event);
    });

  const resolveLatestThreadContent = (
    event: NotificationEvent,
    threadId: ThreadId,
  ): Effect.Effect<string | null> => {
    if (event.type === "thread.activity-appended") {
      return Effect.succeed(normalizeNotificationText(event.payload.activity.summary));
    }
    if (event.type !== "turn.completed") {
      return Effect.succeed(null);
    }
    return Effect.gen(function* () {
      const runtimeContent = yield* takeRuntimeThreadContent(event);
      const projectedContent = yield* resolveLatestProjectedThreadContent(threadId);
      return selectLatestThreadContentForTurnCompletion({
        event,
        runtimeContent,
        projectedContent,
      });
    });
  };

  const processEvent = Effect.fn("processWebPushNotificationEvent")(function* (
    event: NotificationEvent,
  ) {
    const threadId = notificationThreadId(event);
    const [environment, thread] = yield* Effect.all([
      serverEnvironment.getDescriptor,
      resolveThread(threadId),
    ]);
    if (event.type === "turn.completed" && !shouldNotifyRuntimeTurnCompletion(event, thread)) {
      yield* takeRuntimeThreadContent(event).pipe(Effect.asVoid);
      return;
    }
    const threadTitle = Option.match(thread, {
      onNone: () => "Salchi thread",
      onSome: (threadShell) => threadShell.title,
    });
    const latestThreadContent = yield* resolveLatestThreadContent(event, threadId);
    const payload = deriveWebPushPayloadForEvent({
      event,
      environmentId: environment.environmentId,
      threadTitle,
      latestThreadContent,
    });
    if (payload === null) {
      return;
    }
    yield* push.sendToActiveSubscriptions({ payload }).pipe(
      Effect.tap((result) =>
        result.failedCount > 0
          ? Effect.logWarning("web push notification had delivery failures", {
              sentCount: result.sentCount,
              failedCount: result.failedCount,
              eventType: event.type,
              threadId,
            })
          : Effect.void,
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("web push notification reactor failed to send", {
          eventType: event.type,
          threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  });

  const worker = yield* makeDrainableWorker(processEvent);

  return {
    start: Effect.fn("startWebPushNotificationReactor")(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (event.type !== "thread.activity-appended") {
            return Effect.void;
          }
          return worker.enqueue(event);
        }),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
            return Effect.sync(() => {
              trackRuntimeContentDelta(runtimeContentByTurn, event, event.payload.delta);
            });
          }
          if (event.type === "item.completed" && event.payload.itemType === "assistant_message") {
            const detail = normalizeNotificationText(event.payload.detail);
            if (detail !== null) {
              return Effect.sync(() => {
                trackRuntimeMessageContent(runtimeContentByTurn, event, detail);
              });
            }
          }
          if (event.type === "turn.started" || event.type === "turn.aborted") {
            return Effect.sync(() => {
              runtimeContentByTurn.delete(threadTurnKey(event.threadId, event.turnId));
            });
          }
          if (event.type !== "turn.completed") {
            return Effect.void;
          }
          return worker.enqueue(event);
        }),
      );
    }),
  };
});

export const WebPushNotificationReactorLive = Layer.effect(WebPushNotificationReactor, make);

export const WebPushNotificationReactorNoop = Layer.succeed(WebPushNotificationReactor, {
  start: () => Effect.void,
} satisfies WebPushNotificationReactorShape);
