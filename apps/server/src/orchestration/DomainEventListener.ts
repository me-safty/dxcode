import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";

export interface DomainEventListenerOptions {
  readonly label: string;
}

export const forkDomainEventListener = <E, R>(
  orchestrationEngine: Pick<OrchestrationEngineShape, "subscribeDomainEvents">,
  handler: (event: OrchestrationEvent) => Effect.Effect<void, E, R>,
  options: DomainEventListenerOptions,
): Effect.Effect<void, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const domainEventSubscription = yield* orchestrationEngine.subscribeDomainEvents;
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromSubscription(domainEventSubscription), (event) =>
        handler(event).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.failCause(cause);
            }
            return Effect.logWarning("domain event listener failed", {
              listener: options.label,
              eventType: event.type,
              cause: Cause.pretty(cause),
            });
          }),
        ),
      ),
    );
  });
