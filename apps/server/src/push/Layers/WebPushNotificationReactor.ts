import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationThreadShell,
  ProviderRuntimeEvent,
  ServerPushNotificationPayload,
  ThreadId,
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

function threadUrl(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

function notificationThreadId(event: NotificationEvent): ThreadId {
  return event.type === "turn.completed" ? event.threadId : event.payload.threadId;
}

function shouldNotifyRuntimeTurnCompletion(
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  thread: Option.Option<OrchestrationThreadShell>,
): boolean {
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
}): ServerPushNotificationPayload | null {
  const threadId = notificationThreadId(input.event);
  const url = threadUrl(input.environmentId, threadId);
  const body = input.threadTitle;

  switch (input.event.type) {
    case "thread.activity-appended": {
      const activity = input.event.payload.activity;
      if (activity.kind === "approval.requested") {
        return {
          title: activity.summary,
          body,
          url,
          tag: `thread:${input.event.payload.threadId}:approval:${activity.id}`,
        };
      }
      if (activity.kind === "user-input.requested") {
        return {
          title: "Input requested",
          body,
          url,
          tag: `thread:${input.event.payload.threadId}:input:${activity.id}`,
        };
      }
      return null;
    }

    case "thread.turn-diff-completed":
      return null;

    case "turn.completed":
      return {
        title:
          input.event.payload.state === "failed"
            ? "Agent turn finished with errors"
            : "Agent turn completed",
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

  const resolveThread = (threadId: ThreadId) =>
    projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.catch(() => Effect.succeed(Option.none<OrchestrationThreadShell>())));

  const processEvent = Effect.fn("processWebPushNotificationEvent")(function* (
    event: NotificationEvent,
  ) {
    const threadId = notificationThreadId(event);
    const [environment, thread] = yield* Effect.all([
      serverEnvironment.getDescriptor,
      resolveThread(threadId),
    ]);
    if (event.type === "turn.completed" && !shouldNotifyRuntimeTurnCompletion(event, thread)) {
      return;
    }
    const threadTitle = Option.match(thread, {
      onNone: () => "T3 Code thread",
      onSome: (threadShell) => threadShell.title,
    });
    const payload = deriveWebPushPayloadForEvent({
      event,
      environmentId: environment.environmentId,
      threadTitle,
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
