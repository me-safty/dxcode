import type { BoardId, TicketId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { WorkflowEventStoreError } from "./Errors.ts";

export interface WorkflowWebhookConfigResult {
  readonly path: string;
  readonly hasToken: boolean;
  readonly tokenPrefix?: string;
  /** Present only when the token was just created or rotated. */
  readonly token?: string;
}

export type WorkflowWebhookOutcome = "moved" | "queued" | "noop" | "duplicate";

export interface WorkflowExternalEventInput {
  readonly boardId: BoardId;
  readonly name: string;
  readonly ticketId: TicketId;
  readonly payload: unknown;
  readonly deliveryId?: string;
}

/**
 * Per-board webhook ingress: token issue/verify (sha256 at rest, plaintext
 * shown once) and delivery dedupe. Event evaluation itself lives in the
 * engine (ingestExternalEvent).
 */
export interface WorkflowWebhookShape {
  readonly getConfig: (
    boardId: BoardId,
    rotate: boolean,
  ) => Effect.Effect<WorkflowWebhookConfigResult, WorkflowEventStoreError>;
  readonly verifyToken: (
    boardId: BoardId,
    token: string,
  ) => Effect.Effect<boolean, WorkflowEventStoreError>;
  /**
   * Records a delivery id and reports whether it was already seen. Inserts the
   * row ON CONFLICT DO NOTHING and returns `false` (fresh — proceed to ingest)
   * only when this call actually inserted the row; returns `true` (duplicate —
   * skip) when a row already existed. Concurrency-safe: of two concurrent
   * deliveries with the same id, exactly one wins the INSERT (gets `false`) and
   * the other sees the conflict (gets `true`), so the event is ingested once.
   */
  readonly recordDelivery: (
    boardId: BoardId,
    deliveryId: string,
  ) => Effect.Effect<boolean, WorkflowEventStoreError>;
  /**
   * Forgets a delivery row after a failed ingest so the sender's retry is
   * ingested instead of being answered "duplicate". Best-effort.
   */
  readonly releaseDelivery: (
    boardId: BoardId,
    deliveryId: string,
  ) => Effect.Effect<void, WorkflowEventStoreError>;
  /**
   * Drops the token and delivery log when a board is deleted, so a recreated
   * board with the same id never inherits the old token holder's access.
   */
  readonly deleteForBoard: (boardId: BoardId) => Effect.Effect<void, WorkflowEventStoreError>;
}

export class WorkflowWebhook extends Context.Service<WorkflowWebhook, WorkflowWebhookShape>()(
  "t3/workflow/Services/WorkflowWebhook",
) {}
