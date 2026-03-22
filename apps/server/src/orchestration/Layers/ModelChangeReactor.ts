import {
  CommandId,
  EventId,
  type OrchestrationEvent,
  type ThreadModelChangedActivityPayload,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import {
  ModelChangeReactor,
  type ModelChangeReactorShape,
} from "../Services/ModelChangeReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";

type ModelSetDomainEvent = Extract<OrchestrationEvent, { type: "thread.model-set" }>;

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

  const appendModelChangeActivity = (event: ModelSetDomainEvent) => {
    const payload: ThreadModelChangedActivityPayload = {
      fromModel: event.payload.previousModel,
      toModel: event.payload.model,
      source: event.payload.source === "client" ? "user" : "provider-reroute",
      ...(event.payload.reason !== undefined ? { reason: event.payload.reason } : {}),
    };

    return orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("thread-model-change-notice"),
      threadId: event.payload.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "info",
        kind: "thread.model.changed",
        summary: "Model changed",
        payload,
        turnId: null,
        createdAt: event.payload.updatedAt,
      },
      createdAt: event.payload.updatedAt,
    });
  };

  const worker = yield* makeDrainableWorker((event: ModelSetDomainEvent) =>
    appendModelChangeActivity(event),
  );

  const start: ModelChangeReactorShape["start"] = Effect.forkScoped(
    Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
      if (event.type !== "thread.model-set") {
        return Effect.void;
      }
      return worker.enqueue(event);
    }),
  );

  return {
    start,
    drain: worker.drain,
  } satisfies ModelChangeReactorShape;
});

export const ModelChangeReactorLive = Layer.effect(ModelChangeReactor, make);
