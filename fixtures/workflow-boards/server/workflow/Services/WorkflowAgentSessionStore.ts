import type { BoardId, LaneKey, TicketId } from "../../../contracts/workflow.ts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { WorkflowEventStoreError } from "./Errors.ts";

/**
 * Stable workflow-agent session row for one `(ticketId, laneKey, agentKey)`.
 * The stored threadId is reused by continueSession steps.
 */
export interface WorkflowAgentSessionRow {
  readonly ticketId: TicketId;
  readonly laneKey: LaneKey;
  readonly agentKey: string;
  readonly threadId: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

export interface WorkflowAgentSessionStoreShape {
  readonly upsert: (
    ticketId: TicketId,
    laneKey: LaneKey,
    agentKey: string,
    threadId: string,
  ) => Effect.Effect<void, WorkflowEventStoreError>;
  readonly getThreadId: (
    ticketId: TicketId,
    laneKey: LaneKey,
    agentKey: string,
  ) => Effect.Effect<string | null, WorkflowEventStoreError>;
  readonly listByTicket: (
    ticketId: TicketId,
  ) => Effect.Effect<ReadonlyArray<WorkflowAgentSessionRow>, WorkflowEventStoreError>;
  readonly deleteByTicket: (ticketId: TicketId) => Effect.Effect<void, WorkflowEventStoreError>;
  readonly listByBoard: (
    boardId: BoardId,
  ) => Effect.Effect<ReadonlyArray<WorkflowAgentSessionRow>, WorkflowEventStoreError>;
  readonly deleteByBoard: (boardId: BoardId) => Effect.Effect<void, WorkflowEventStoreError>;
}

export class WorkflowAgentSessionStore extends Context.Service<
  WorkflowAgentSessionStore,
  WorkflowAgentSessionStoreShape
>()("@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowAgentSessionStore") {}
