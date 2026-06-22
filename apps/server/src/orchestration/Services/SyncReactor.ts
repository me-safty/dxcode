/**
 * SyncReactor - "Sync with remote" reaction service interface.
 *
 * Owns a background worker that reacts to `thread.sync-requested` events and
 * performs the fetch + merge (with AI-assisted conflict resolution) against the
 * thread's current branch.
 *
 * @module SyncReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * SyncReactorShape - Service API for the sync reactor lifecycle.
 */
export interface SyncReactorShape {
  /**
   * Start the sync reactor.
   *
   * The returned effect must be run in a scope so the worker fiber can be
   * finalized on shutdown. Consumes orchestration-domain events via an internal
   * queue.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * SyncReactor - Service tag for the sync-with-remote reactor worker.
 */
export class SyncReactor extends Context.Service<SyncReactor, SyncReactorShape>()(
  "t3/orchestration/Services/SyncReactor",
) {}
