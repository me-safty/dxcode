import type * as Scope from "effect/Scope";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { BoardId, TicketId } from "../../../contracts/workflow.ts";
import type { WorkflowEventStoreError } from "./Errors.ts";

export interface WorkflowWebhookConfigResult {
  readonly path: string;
  readonly hasToken: boolean;
  readonly tokenPrefix?: string;
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

export interface WorkflowWebhookShape {
  readonly getConfig: (
    boardId: BoardId,
    rotate: boolean,
  ) => Effect.Effect<WorkflowWebhookConfigResult, WorkflowEventStoreError>;
  readonly verifyToken: (
    boardId: BoardId,
    token: string,
  ) => Effect.Effect<boolean, WorkflowEventStoreError>;
  readonly recordDelivery: (
    boardId: BoardId,
    deliveryId: string,
  ) => Effect.Effect<boolean, WorkflowEventStoreError>;
  readonly releaseDelivery: (
    boardId: BoardId,
    deliveryId: string,
  ) => Effect.Effect<void, WorkflowEventStoreError>;
  readonly deleteForBoard: (boardId: BoardId) => Effect.Effect<void, WorkflowEventStoreError>;
  readonly pruneStaleDeliveries: (
    beforeIso: string,
  ) => Effect.Effect<number, WorkflowEventStoreError>;
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class WorkflowWebhook extends Context.Service<WorkflowWebhook, WorkflowWebhookShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowWebhook",
) {}
