/**
 * ModelChangeReactor - Thread model change notice reaction service interface.
 *
 * Owns background workers that react to durable thread model changes and
 * append inline timeline notices as orchestration activities.
 *
 * @module ModelChangeReactor
 */
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface ModelChangeReactorShape {
  /**
   * Start reacting to thread model-set domain events.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

export class ModelChangeReactor extends ServiceMap.Service<
  ModelChangeReactor,
  ModelChangeReactorShape
>()("t3/orchestration/Services/ModelChangeReactor") {}
