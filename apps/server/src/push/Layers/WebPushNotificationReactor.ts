import type {
  EnvironmentId,
  OrchestrationEvent,
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
import {
  WebPushNotificationReactor,
  type WebPushNotificationReactorShape,
} from "../Services/WebPushNotificationReactor.ts";
import { WebPushService } from "../Services/WebPushService.ts";

type NotificationEvent = Extract<
  OrchestrationEvent,
  { type: "thread.activity-appended" | "thread.turn-diff-completed" }
>;

function threadUrl(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

export function deriveWebPushPayloadForEvent(input: {
  readonly event: NotificationEvent;
  readonly environmentId: EnvironmentId;
  readonly threadTitle: string;
}): ServerPushNotificationPayload | null {
  const url = threadUrl(input.environmentId, input.event.payload.threadId);
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
      return {
        title:
          input.event.payload.status === "error"
            ? "Agent turn finished with errors"
            : "Agent turn completed",
        body,
        url,
        tag: `thread:${input.event.payload.threadId}:turn:${input.event.payload.turnId}`,
      };
  }
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const push = yield* WebPushService;
  const serverEnvironment = yield* ServerEnvironment;

  const resolveThreadTitle = (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadShellById(threadId).pipe(
      Effect.map(
        Option.match({
          onNone: () => "T3 Code thread",
          onSome: (thread) => thread.title,
        }),
      ),
      Effect.catch(() => Effect.succeed("T3 Code thread")),
    );

  const processEvent = Effect.fn("processWebPushNotificationEvent")(function* (
    event: NotificationEvent,
  ) {
    const [environment, threadTitle] = yield* Effect.all([
      serverEnvironment.getDescriptor,
      resolveThreadTitle(event.payload.threadId),
    ]);
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
              threadId: event.payload.threadId,
            })
          : Effect.void,
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("web push notification reactor failed to send", {
          eventType: event.type,
          threadId: event.payload.threadId,
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
          if (
            event.type !== "thread.activity-appended" &&
            event.type !== "thread.turn-diff-completed"
          ) {
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
